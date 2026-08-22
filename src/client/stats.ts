/**
 * NoLetMe counting engine.
 *
 * Scans reasoning blocks for the keyword taxonomy and folds them into one
 * session-wide trajectory snapshot. Counting is a single left-to-right walk
 * per reasoning block (longest match wins at each token position, so "we need"
 * consumes "we need" rather than also matching a bare "we"), plus an
 * independent pass for the raw research word metrics (`we`, `let's`, `let me`,
 * first-person `I`).
 *
 * The engine is **incremental**: per-block counts are cached in a WeakMap
 * keyed by the AssistantBlock object identity, and the session accumulator
 * (see `accumulator.ts`) folds only nodes whose seq lies outside the already
 * counted range. A stream delta therefore recounts at most the one in-flight
 * block, and revisiting a session after a reload adds only what is new — it
 * never re-walks the whole conversation.
 */

import type { AssistantBlockView, ConversationView } from './conversation.ts'
import { emptyGrayProbe, probeGraySession, type GrayProbe } from './graytest.ts'
import {
  FIRST_TOKEN_ORDER, GROUPS, LATER_TOKEN_ORDER, PATTERNS, type Group, type Mode,
} from './keywords.ts'

/** Version of the session classifier and its scoring rules. */
export const CLASSIFIER_VERSION = 1 as const

/** Raw word-level research metrics. */
export interface WordCounts {
  /** Bare "we" tokens (the minimal-trajectory metric: 272/231/179/165 vs 11/16). */
  we: number
  /** "Let's" tokens (88–117 in high-scoring runs, 0–2 in Standard/PTC). */
  lets: number
  /** "let me" bigrams (0 in minimal, 194–249 in Standard/PTC). */
  letMe: number
  /** First-person tokens: I, I'm, I'll, I've (high in Standard/PTC, low in minimal). */
  firstPerson: number
}

/** Per-pattern occurrence counts, indexed by PATTERNS order. */
export type PatternCounts = readonly number[]

/** Counts for one reasoning block. */
export interface BlockCounts {
  readonly patterns: PatternCounts
  readonly words: WordCounts
  readonly chars: number
}

/** Mutable session-wide fold target. */
export interface SessionCounts {
  patterns: number[]
  words: WordCounts
  blocks: number
  chars: number
  replies: number
}

/**
 * Reasoning-output health. The research method counts keywords over
 * **reasoning blocks only**; when a model streams its output as visible text
 * instead of reasoning, the reasoning trajectory is absent and NoLetMe must
 * not fabricate one from the text. It reports the anomaly instead.
 */
export type ReasoningAnomaly = 'none' | 'missing' | 'low'

/**
 * Session-wide trajectory stats folded from a conversation snapshot. `blocks`
 * and `chars` are always the *reasoning* surface (the evidence method); text
 * blocks contribute only diagnostic totals used to flag a missing/starved
 * reasoning trajectory.
 */
export interface TrajectoryStats {
  /** Reasoning health: flags a model that streamed output as text instead of reasoning. */
  readonly anomaly: ReasoningAnomaly
  /** Reasoning blocks seen (finalized nodes + in-flight partial). */
  readonly blocks: number
  /** Reasoning characters. */
  readonly chars: number
  /** Visible text blocks (diagnostic only — never word-counted). */
  readonly textBlocks: number
  /** Visible text characters (diagnostic only). */
  readonly textChars: number
  /** Completed assistant messages (the "stage replies" axis: 1 vs 55). */
  readonly replies: number
  /** Whether a turn is streaming right now. */
  readonly streaming: boolean
  /** Category totals (sum of the category's pattern occurrences). */
  readonly groups: Readonly<Record<Group, number>>
  /** Every pattern's occurrence count, indexed by PATTERNS order. */
  readonly patterns: PatternCounts
  /** Raw word metrics. */
  readonly words: WordCounts
  /** Category shares of the total keyword occurrences (0..1). */
  readonly shares: Readonly<Record<Group, number>>
  /** Dominant trajectory, per the research classifier. */
  readonly mode: Mode
  /** 0..1 hesitation pressure: letMe / (we + let's + letMe). */
  readonly hesitation: number
  /**
   * Gray-test probe over **all loaded reasoning blocks**. Independent of the
   * 0813 session classifier.
   */
  readonly gray: GrayProbe
}

const EMPTY_COUNTS: BlockCounts = {
  patterns: Object.freeze(new Array(PATTERNS.length).fill(0)) as PatternCounts,
  words: { we: 0, lets: 0, letMe: 0, firstPerson: 0 },
  chars: 0,
}

/** Per-block count cache keyed by block object identity. */
const blockCache: WeakMap<AssistantBlockView, BlockCounts> = new WeakMap()

/** Split a normalized token stream once per block. */
function tokenize(text: string): readonly string[] {
  // Lowercase, split on whitespace, strip leading/trailing non-word/apostrophe
  // characters ("Good." → "good", "I'm" → "i'm", "—" → filtered).
  return text
    .toLowerCase()
    .split(/\s+/u)
    .map(token => token.replace(/^[^a-z0-9']+|[^a-z0-9']+$/gu, ''))
    .filter(token => token !== '')
}

const FIRST_PERSON = new Set(['i', "i'm", 'i\'ll', 'i\'ve'])

/**
 * Count one reasoning text. Public for tests; the session fold uses the cache.
 * @param text - raw reasoning block text.
 * @returns per-pattern and raw-word counts plus character length.
 */
export function countReasoningText(text: string): BlockCounts {
  if (text === '') return EMPTY_COUNTS
  const tokens = tokenize(text)
  if (tokens.length === 0) return { ...EMPTY_COUNTS, chars: text.length }

  const patterns = new Array<number>(PATTERNS.length).fill(0)
  // Pattern walk: longest match first at each position; a block-start pattern
  // only competes at the first token. Matching consumes the whole pattern so
  // overlapping patterns never double-count at the same span.
  let cursor = 0
  while (cursor < tokens.length) {
    let matched = false
    const order = cursor === 0 ? FIRST_TOKEN_ORDER : LATER_TOKEN_ORDER
    for (const index of order) {
      const pattern = PATTERNS[index]
      if (cursor + pattern.tokens.length > tokens.length) continue
      let ok = true
      for (let k = 0; k < pattern.tokens.length; k++) {
        if (tokens[cursor + k] !== pattern.tokens[k]) { ok = false; break }
      }
      if (!ok) continue
      patterns[index] += 1
      cursor += pattern.tokens.length
      matched = true
      break
    }
    if (!matched) cursor += 1
  }

  // Raw word metrics (independent of pattern consumption, matching the
  // research counting: a "we need" contributes one bare "we").
  let we = 0
  let lets = 0
  let letMe = 0
  let firstPerson = 0
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token === 'we') we += 1
    else if (token === "let's") lets += 1
    else if (FIRST_PERSON.has(token)) firstPerson += 1
    if (token === 'let' && tokens[i + 1] === 'me') letMe += 1
  }

  return { patterns, words: { we, lets, letMe, firstPerson }, chars: text.length }
}

/**
 * Cached per-block count. Streaming deltas replace the block object, so only
 * the changed block recounts.
 * @param block - one reasoning block.
 * @returns its counts (cached by block identity).
 */
export function countBlock(block: AssistantBlockView): BlockCounts {
  if (block.kind !== 'reasoning' || block.text === undefined || block.text === '') return EMPTY_COUNTS
  const cached = blockCache.get(block)
  if (cached !== undefined) return cached
  const counts = countReasoningText(block.text)
  blockCache.set(block, counts)
  return counts
}

/** Fresh, zeroed session fold target. */
export function emptySessionCounts(): SessionCounts {
  return {
    patterns: new Array<number>(PATTERNS.length).fill(0),
    words: { we: 0, lets: 0, letMe: 0, firstPerson: 0 },
    blocks: 0,
    chars: 0,
    replies: 0,
  }
}

/**
 * Fold one block into a session count target (incremental: reuses the block
 * cache). Non-reasoning blocks contribute nothing.
 * @param target - mutable session counts.
 * @param block - assistant block.
 */
export function foldBlock(target: SessionCounts, block: AssistantBlockView): void {
  if (block.kind !== 'reasoning') return
  const counts = countBlock(block)
  if (counts.chars === 0) return
  target.blocks += 1
  target.chars += counts.chars
  for (let i = 0; i < target.patterns.length; i++) target.patterns[i] += counts.patterns[i]
  target.words.we += counts.words.we
  target.words.lets += counts.words.lets
  target.words.letMe += counts.words.letMe
  target.words.firstPerson += counts.words.firstPerson
}

/**
 * Classify reasoning health from output volumes. Text contributes only as a
 * diagnostic: when a conversation carries visible text but no (or almost no)
 * reasoning, the reasoning trajectory the keywords fingerprint does not exist,
 * and the panel reports it rather than inventing counts.
 * @param reasoningChars - reasoning characters (0 when none).
 * @param reasoningBlocks - reasoning block count.
 * @param textChars - visible text characters.
 * @param textBlocks - visible text block count.
 * @returns the anomaly grade.
 */
export function anomalyOf(
  reasoningChars: number,
  reasoningBlocks: number,
  textChars: number,
  textBlocks: number,
): ReasoningAnomaly {
  if (textChars === 0 && textBlocks === 0) return 'none'
  if (reasoningBlocks === 0 || reasoningChars === 0) return 'missing'
  if (reasoningChars / textChars < 0.05) return 'low'
  return 'none'
}

/**
 * Derive the presentational trajectory stats from a fold target.
 * @param counts - folded reasoning counts.
 * @param streaming - whether a turn is streaming.
 * @param diagnostics - visible-text totals used for the anomaly grade.
 * @param gray - session-wide gray-test probe (defaults to empty).
 */
export function toTrajectoryStats(
  counts: SessionCounts,
  streaming: boolean,
  diagnostics: { textBlocks: number; textChars: number },
  gray: GrayProbe = emptyGrayProbe(),
): TrajectoryStats {
  const groups = {} as Record<Group, number>
  for (const group of GROUPS) {
    let total = 0
    for (let i = 0; i < PATTERNS.length; i++) {
      if (PATTERNS[i].group === group) total += counts.patterns[i]
    }
    groups[group] = total
  }

  const total = groups.efficient + groups.hesitant + groups.neutral
  const shares = {} as Record<Group, number>
  for (const group of GROUPS) shares[group] = total === 0 ? 0 : groups[group] / total

  // Research classifier: any `let me` → hesitant; else bare `we`/`let's` → efficient.
  const mode: Mode = counts.words.letMe > 0
    ? 'hesitant'
    : counts.words.we > 0 || counts.words.lets > 0
      ? 'efficient'
      : 'neutral'

  const denominator = counts.words.we + counts.words.lets + counts.words.letMe
  const hesitation = denominator === 0 ? 0 : counts.words.letMe / denominator

  return {
    anomaly: anomalyOf(counts.chars, counts.blocks, diagnostics.textChars, diagnostics.textBlocks),
    blocks: counts.blocks,
    chars: counts.chars,
    textBlocks: diagnostics.textBlocks,
    textChars: diagnostics.textChars,
    replies: counts.replies,
    streaming,
    groups,
    patterns: counts.patterns,
    words: { ...counts.words },
    shares,
    mode,
    hesitation,
    gray,
  }
}

/**
 * One-shot fold over a snapshot — kept for tests and the no-session null case.
 * The live panel uses the incremental accumulator (`accumulator.ts`).
 * @param snapshot - current conversation snapshot (undefined → null result).
 * @returns stats, or null while no session is current.
 */
export function computeStats(snapshot: ConversationView | undefined): TrajectoryStats | null {
  if (snapshot === undefined) return null
  const counts = emptySessionCounts()
  let textBlocks = 0
  let textChars = 0
  const fold = (block: AssistantBlockView): void => {
    if (block.kind === 'reasoning') foldBlock(counts, block)
    else if (block.kind === 'text' && block.text !== undefined) {
      textBlocks += 1
      textChars += block.text.length
    }
  }
  for (const node of snapshot.nodes) {
    if (node.kind !== 'assistant') continue
    counts.replies += 1
    for (const block of node.blocks ?? []) fold(block)
  }
  if (snapshot.partial !== null) {
    for (const block of snapshot.partial.blocks) fold(block)
  }
  return toTrajectoryStats(
    counts,
    snapshot.partial !== null,
    { textBlocks, textChars },
    probeGraySession(snapshot),
  )
}

/** Human-scale reasoning characters: 12.4K / 1.2M. */
export function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}K`
  return String(value)
}
