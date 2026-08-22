/**
 * Gray-test probe for the **current turn**.
 *
 * The 0813 trajectory classifier (`stats.ts` / `keywords.ts`) stays untouched:
 * it still folds the whole session into We-need / Let-me / The-user-wants. This
 * module answers a different question the 0813 word list cannot: did *this*
 * round draw the community gray-test backend?
 *
 * Features are the ones reported across the 2026-06 expert-mode gray, the
 * 2026-07 "summary CoT" Web gray, and the 2026-08-19/08-20 V4 Pro reruns
 * (linux.do / locdd / X):
 *
 *   - lexical fingerprint `I'm doing` / `I am doing` (absent from 0813 GA)
 *   - summary-shaped CoT (list/outline, short paragraphs, "list then do")
 *   - chunked reasoning blocks (段尾停顿 → 下一段突然一大段)
 *   - leaked dirty tokens (`Nameeee`, `antml:thinking`, …)
 *   - leaked backend fingerprint strings (`fp_v4pro_…`)
 *
 * None of these prove routing or identity — they are observational hits. The
 * panel reports a conservative verdict plus the raw evidence.
 */

import type { AssistantBlockView, ConversationView } from './conversation.ts'

/** Version of the gray-test probe (independent of the 0813 classifier). */
export const GRAYTEST_VERSION = 1 as const

/** How confidently this turn matches the gray-test cluster. */
export type GrayVerdict = 'miss' | 'possible' | 'likely'

/** Dominant gray-test family, when any. */
export type GrayProfile = 'none' | 'im-doing' | 'summary' | 'fingerprint'

/** One named signal the probe scored. */
export interface GrayEvidence {
  readonly id: string
  readonly hit: boolean
  readonly detail?: string
}

/** Probe result for the current assistant turn. */
export interface GrayProbe {
  readonly verdict: GrayVerdict
  /** 0..1, score / 8 clamped. */
  readonly confidence: number
  readonly profile: GrayProfile
  readonly score: number
  /** First-line opener of the first reasoning block (truncated). */
  readonly opener: string
  /** `I'm doing` / `I am doing` hits in this turn's reasoning. */
  readonly imDoing: number
  /** 0..1 outline/list density. */
  readonly summaryScore: number
  /** Several mid-length reasoning blocks in one turn (chunked delivery). */
  readonly chunked: boolean
  /** Distinct dirty-token hits found in reasoning. */
  readonly dirtyTokens: readonly string[]
  /** Distinct `fp_…` backend fingerprint strings. */
  readonly fingerprints: readonly string[]
  readonly evidence: readonly GrayEvidence[]
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

/**
 * The in-flight partial, otherwise the last finalized assistant node — that
 * is the "current round" the gray-test draw applies to.
 */
export function currentTurnOf(snapshot: ConversationView): readonly AssistantBlockView[] {
  if (snapshot.partial !== null) return snapshot.partial.blocks
  for (let i = snapshot.nodes.length - 1; i >= 0; i--) {
    const node = snapshot.nodes[i]
    if (node.kind === 'assistant') return node.blocks ?? []
  }
  return []
}

function reasoningTexts(blocks: readonly AssistantBlockView[]): string[] {
  const out: string[] = []
  for (const block of blocks) {
    if (block.kind !== 'reasoning' || block.text === undefined || block.text === '') continue
    out.push(block.text)
  }
  return out
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

function summaryShape(text: string): { listRatio: number; shortPara: boolean } {
  const lines = text.split(/\n+/u).map(line => line.trim()).filter(line => line !== '')
  if (lines.length === 0) return { listRatio: 0, shortPara: false }
  let list = 0
  for (const line of lines) {
    if (/^(?:[-*•]|\d+[.)]|#{1,3}\s)/u.test(line)) list += 1
  }
  const avg = text.length / lines.length
  return {
    listRatio: list / lines.length,
    shortPara: lines.length >= 3 && avg < 140,
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

/**
 * Probe one turn's reasoning blocks. Public for tests; the session fold calls
 * this on the current turn only (never on the whole history).
 * @param blocks - assistant blocks of the current turn.
 */
export function probeGray(blocks: readonly AssistantBlockView[]): GrayProbe {
  const texts = reasoningTexts(blocks)
  if (texts.length === 0) return EMPTY_PROBE

  const joined = texts.join('\n')
  const opener = firstLine(texts[0])
  const imDoing = countImDoing(joined)
  const letMe = countLetMe(joined)
  const we = countWe(joined)
  const shape = summaryShape(joined)
  // Outline bullets are the summary-CoT tell. Short paragraphs alone are too
  // common in 0813 We-need blocks to count without an I'm-doing fingerprint.
  const summaryHit = shape.listRatio >= 0.35 || (shape.shortPara && imDoing > 0)
  const summaryScore = clamp01(shape.listRatio + (shape.shortPara ? 0.35 : 0))

  const lengths = texts.map(text => text.length)
  const mid = median(lengths)
  const chunked = texts.length >= 3 && mid >= 30 && mid <= 800

  const dirtyTokens: string[] = []
  for (const token of DIRTY_TOKENS) {
    if (token.pattern.test(joined)) dirtyTokens.push(token.id)
  }

  const fingerprints = unique(joined.match(FINGERPRINT_RE) ?? [])

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
      detail: `${Math.round(shape.listRatio * 100)}% list`,
    })
  }
  // Streaming cadence (段尾停顿) is not in the snapshot. Multiple reasoning
  // blocks per turn is also how 0813 stores a long trajectory, so chunking
  // only supports a hit that already has I'm-doing / outline / leaked fp.
  if (chunked && (imDoing > 0 || summaryHit || dirtyTokens.length > 0 || fingerprints.length > 0)) {
    score += 1
    evidence.push({ id: 'chunked-blocks', hit: true, detail: `${texts.length} blocks` })
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
      : summaryHit || chunked
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
    evidence,
  }
}

/**
 * Probe the current turn of a conversation snapshot.
 * @param snapshot - live conversation view.
 */
export function probeGrayTurn(snapshot: ConversationView): GrayProbe {
  return probeGray(currentTurnOf(snapshot))
}

/** Empty probe (no reasoning in the current turn). */
export function emptyGrayProbe(): GrayProbe {
  return EMPTY_PROBE
}
