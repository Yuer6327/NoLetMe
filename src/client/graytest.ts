/**
 * Gray-test probe over **every reasoning block** in the loaded conversation.
 *
 * The 0813 trajectory classifier (`stats.ts` / `keywords.ts`) stays untouched:
 * it still folds We-need / Let-me / The-user-wants. This module answers a
 * different question: does the loaded reasoning match the community gray-test
 * cluster (2026-06 expert-mode, 2026-07 summary CoT, 2026-08-19/08-20
 * `I'm doing` reruns)?
 *
 * Scoring is observational, not a routing proof. Style numbers (list density,
 * p50 block length, type-token ratio) are reported as complete data even on a
 * miss so the panel can show the fingerprint without a prose caption.
 */

import type { AssistantBlockView, ConversationView } from './conversation.ts'

/** Version of the gray-test probe (independent of the 0813 classifier). */
export const GRAYTEST_VERSION = 2 as const

/** How confidently the loaded reasoning matches the gray-test cluster. */
export type GrayVerdict = 'miss' | 'possible' | 'likely'

/** Dominant gray-test family, when any. */
export type GrayProfile = 'none' | 'im-doing' | 'summary' | 'fingerprint'

/** One named signal the probe scored. */
export interface GrayEvidence {
  readonly id: string
  readonly hit: boolean
  readonly detail?: string
}

/** Local style / statistical fingerprint over reasoning (not a model-identity claim). */
export interface StyleStats {
  /** Reasoning blocks folded into the probe. */
  readonly blocks: number
  /** Total reasoning characters. */
  readonly chars: number
  /** Median reasoning-block length. */
  readonly p50: number
  /** Mean reasoning-block length. */
  readonly avg: number
  /** Fraction of non-empty lines that look like list / heading items (0..1). */
  readonly listRatio: number
  /** Type-token ratio of reasoning tokens (0..1). */
  readonly typeToken: number
  /** Mean alphabetic-token length. */
  readonly avgWordLen: number
}

/** Probe result over all loaded reasoning. */
export interface GrayProbe {
  readonly verdict: GrayVerdict
  /** 0..1, score / 8 clamped. */
  readonly confidence: number
  readonly profile: GrayProfile
  readonly score: number
  /** First line of the latest reasoning block (truncated). */
  readonly opener: string
  /** `I'm doing` / `I am doing` hits across all reasoning. */
  readonly imDoing: number
  /** Outline/list density (same as `style.listRatio`). */
  readonly summaryScore: number
  /** Several mid-length reasoning blocks (supporting signal only). */
  readonly chunked: boolean
  /** Distinct dirty-token hits found in reasoning. */
  readonly dirtyTokens: readonly string[]
  /** Distinct `fp_…` backend fingerprint strings. */
  readonly fingerprints: readonly string[]
  readonly style: StyleStats
  readonly evidence: readonly GrayEvidence[]
}

const EMPTY_STYLE: StyleStats = {
  blocks: 0,
  chars: 0,
  p50: 0,
  avg: 0,
  listRatio: 0,
  typeToken: 0,
  avgWordLen: 0,
}

const EMPTY_PROBE: GrayProbe = {
  verdict: 'miss',
  confidence: 0,
  profile: 'none',
  score: 0,
  opener: '',
  imDoing: 0,
  summaryScore: 0,
  chunked: false,
  dirtyTokens: [],
  fingerprints: [],
  style: EMPTY_STYLE,
  evidence: [],
}

/** Community-attested dirty tokens that leak in reasoning (case-insensitive). */
const DIRTY_TOKENS: readonly { id: string; pattern: RegExp }[] = [
  { id: 'Nameeee', pattern: /\bNameeee\b/ },
  { id: 'antml:thinking', pattern: /antml:thinking/i },
  { id: '<antml', pattern: /<\/?antml\b/i },
  { id: 'EDMFunc', pattern: /\bEDMFunc\b/ },
  { id: 'everydaycalculation', pattern: /\beverydaycalculation\b/i },
]

/** Backend fingerprint strings reported during the 08-19 gray (`fp_v4pro_…`). */
const FINGERPRINT_RE = /\bfp_(?:v4pro_)?[a-zA-Z0-9][a-zA-Z0-9_\-]{3,}\b/g

/** `I'm doing` / `I am doing` / jammed `I'mdoing`. */
const IM_DOING_RE = /\bi(?:['’]m| am)\s*doing\b/gi

function reasoningTexts(blocks: readonly AssistantBlockView[]): string[] {
  const out: string[] = []
  for (const block of blocks) {
    if (block.kind !== 'reasoning' || block.text === undefined || block.text === '') continue
    out.push(block.text)
  }
  return out
}

/**
 * Every reasoning block in the loaded snapshot: finalized assistant nodes in
 * order, then the in-flight partial. History not yet paged in is out of scope
 * (same window as the 0813 fold).
 */
export function allReasoningBlocks(snapshot: ConversationView): readonly AssistantBlockView[] {
  const out: AssistantBlockView[] = []
  for (const node of snapshot.nodes) {
    if (node.kind !== 'assistant') continue
    for (const block of node.blocks ?? []) {
      if (block.kind === 'reasoning' && block.text !== undefined && block.text !== '') out.push(block)
    }
  }
  if (snapshot.partial !== null) {
    for (const block of snapshot.partial.blocks) {
      if (block.kind === 'reasoning' && block.text !== undefined && block.text !== '') out.push(block)
    }
  }
  return out
}

/** @deprecated Use {@link allReasoningBlocks}; kept for older tests. */
export function currentTurnOf(snapshot: ConversationView): readonly AssistantBlockView[] {
  return allReasoningBlocks(snapshot)
}

function firstLine(text: string): string {
  const line = text.split(/\r?\n/u, 1)[0]?.trim() ?? ''
  return line.length > 80 ? `${line.slice(0, 77)}…` : line
}

function countImDoing(text: string): number {
  const matches = text.match(IM_DOING_RE)
  return matches === null ? 0 : matches.length
}

function openerIsImDoing(opener: string): boolean {
  return /^(?:i(?:['’]m| am)\s*doing)\b/i.test(opener.trim())
}

function countLetMe(text: string): number {
  const matches = text.match(/\blet\s+me\b/gi)
  return matches === null ? 0 : matches.length
}

function countWe(text: string): number {
  const matches = text.match(/\bwe\b/gi)
  return matches === null ? 0 : matches.length
}

function tokenize(text: string): readonly string[] {
  return text
    .toLowerCase()
    .split(/\s+/u)
    .map(token => token.replace(/^[^a-z0-9']+|[^a-z0-9']+$/gu, ''))
    .filter(token => token !== '')
}

function summaryShape(texts: readonly string[]): { listRatio: number; shortPara: boolean } {
  let lines = 0
  let list = 0
  let chars = 0
  for (const text of texts) {
    const parts = text.split(/\n+/u).map(line => line.trim()).filter(line => line !== '')
    for (const line of parts) {
      lines += 1
      chars += line.length
      if (/^(?:[-*•]|\d+[.)]|#{1,3}\s)/u.test(line)) list += 1
    }
  }
  if (lines === 0) return { listRatio: 0, shortPara: false }
  const avg = chars / lines
  return {
    listRatio: list / lines,
    shortPara: lines >= 3 && avg < 140,
  }
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function unique(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(value)
  }
  return out
}

function clamp01(value: number): number {
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

function styleOf(texts: readonly string[], listRatio: number): StyleStats {
  const lengths = texts.map(text => text.length)
  const chars = lengths.reduce((sum, n) => sum + n, 0)
  const tokens = tokenize(texts.join('\n'))
  const types = new Set(tokens)
  const letterLens = tokens.map(token => token.replace(/'/g, '').length).filter(n => n > 0)
  const wordSum = letterLens.reduce((sum, n) => sum + n, 0)
  return {
    blocks: texts.length,
    chars,
    p50: Math.round(median(lengths)),
    avg: texts.length === 0 ? 0 : Math.round(chars / texts.length),
    listRatio,
    typeToken: tokens.length === 0 ? 0 : types.size / tokens.length,
    avgWordLen: letterLens.length === 0 ? 0 : wordSum / letterLens.length,
  }
}

/**
 * Probe a bag of assistant blocks (tests). Live folding uses {@link probeGraySession}.
 * @param blocks - assistant blocks; non-reasoning entries are ignored.
 */
export function probeGray(blocks: readonly AssistantBlockView[]): GrayProbe {
  const texts = reasoningTexts(blocks)
  if (texts.length === 0) return EMPTY_PROBE

  const joined = texts.join('\n')
  const opener = firstLine(texts[texts.length - 1])
  const imDoing = countImDoing(joined)
  const letMe = countLetMe(joined)
  const we = countWe(joined)
  const shape = summaryShape(texts)
  // Outline bullets are the summary-CoT tell. Short paragraphs alone are too
  // common in 0813 We-need blocks to count without an I'm-doing fingerprint.
  const summaryHit = shape.listRatio >= 0.35 || (shape.shortPara && imDoing > 0)
  const summaryScore = clamp01(shape.listRatio)

  const lengths = texts.map(text => text.length)
  const mid = median(lengths)
  const chunked = texts.length >= 3 && mid >= 30 && mid <= 800

  const dirtyTokens: string[] = []
  for (const token of DIRTY_TOKENS) {
    if (token.pattern.test(joined)) dirtyTokens.push(token.id)
  }

  const fingerprints = unique(joined.match(FINGERPRINT_RE) ?? [])
  const style = styleOf(texts, shape.listRatio)

  const evidence: GrayEvidence[] = []
  let score = 0

  if (imDoing > 0) {
    score += 4
    evidence.push({ id: 'im-doing', hit: true, detail: String(imDoing) })
  }
  if (openerIsImDoing(opener)) {
    score += 2
    evidence.push({ id: 'im-doing-opener', hit: true, detail: opener })
  }
  if (imDoing > 0 && letMe === 0) {
    score += 1
    evidence.push({ id: 'no-let-me', hit: true })
  }
  if (summaryHit) {
    score += 2
    evidence.push({
      id: 'summary-shape',
      hit: true,
      detail: `${Math.round(shape.listRatio * 100)}%`,
    })
  }
  // Streaming cadence (段尾停顿) is not in the snapshot. Many mid-length
  // reasoning blocks is also how 0813 stores a long trajectory, so chunking
  // only supports a hit that already has I'm-doing / outline / leaked fp.
  if (chunked && (imDoing > 0 || summaryHit || dirtyTokens.length > 0 || fingerprints.length > 0)) {
    score += 1
    evidence.push({ id: 'chunked-blocks', hit: true, detail: `${texts.length}` })
  }
  if (dirtyTokens.length > 0) {
    score += 2
    evidence.push({ id: 'dirty-token', hit: true, detail: dirtyTokens.join(', ') })
  }
  if (fingerprints.length > 0) {
    score += 2
    evidence.push({ id: 'backend-fp', hit: true, detail: fingerprints.join(', ') })
  }
  // 0813-standard / 0813-minimal trajectories argue *against* the 08-19 gray.
  if (letMe >= 2 && imDoing === 0) score -= 3
  if (we >= 3 && imDoing === 0 && !summaryHit) score -= 1

  const verdict: GrayVerdict = score >= 5 ? 'likely' : score >= 2 ? 'possible' : 'miss'
  const profile: GrayProfile = imDoing > 0
    ? 'im-doing'
    : dirtyTokens.length > 0 || fingerprints.length > 0
      ? 'fingerprint'
      : summaryHit
        ? 'summary'
        : 'none'

  return {
    verdict,
    confidence: clamp01(Math.max(0, score) / 8),
    profile,
    score,
    opener,
    imDoing,
    summaryScore,
    chunked,
    dirtyTokens,
    fingerprints,
    style,
    evidence,
  }
}

/**
 * Probe every loaded reasoning block of a conversation snapshot.
 * @param snapshot - live conversation view.
 */
export function probeGraySession(snapshot: ConversationView): GrayProbe {
  return probeGray(allReasoningBlocks(snapshot))
}

/** @deprecated Alias of {@link probeGraySession}. */
export function probeGrayTurn(snapshot: ConversationView): GrayProbe {
  return probeGraySession(snapshot)
}

/** Empty probe (no reasoning loaded). */
export function emptyGrayProbe(): GrayProbe {
  return EMPTY_PROBE
}
