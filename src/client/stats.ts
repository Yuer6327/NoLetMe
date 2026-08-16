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
 * Per-block counts are cached in a WeakMap keyed by the AssistantBlock object
 * identity. The conversation snapshot is immutable and keeps stable references
 * for unchanged nodes, so a stream delta only recounts the one in-flight block
 * that actually changed — re-renders stay O(delta), not O(session).
 */

import type {
  AssistantBlock, ConversationNode, ConversationSnapshot,
} from '@deepseek-ai/dsh-client-runtime/client'
import {
  FIRST_TOKEN_ORDER, GROUPS, LATER_TOKEN_ORDER, PATTERNS, type Group, type Mode,
} from './keywords.ts'

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

/** Session-wide trajectory stats folded from a conversation snapshot. */
export interface TrajectoryStats {
  /** Reasoning blocks seen (finalized nodes + in-flight partial). */
  readonly blocks: number
  /** Total reasoning characters. */
  readonly chars: number
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
}

const EMPTY_COUNTS: BlockCounts = {
  patterns: Object.freeze(new Array(PATTERNS.length).fill(0)) as PatternCounts,
  words: { we: 0, lets: 0, letMe: 0, firstPerson: 0 },
  chars: 0,
}

/** Per-block count cache keyed by block object identity. */
const blockCache = new WeakMap<AssistantBlock, BlockCounts>()

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

/** Cached per-block count (streaming deltas replace the block object, so only the changed block recounts). */
function blockCounts(block: AssistantBlock): BlockCounts {
  if (block.kind !== 'reasoning' || block.text === '') return EMPTY_COUNTS
  const cached = blockCache.get(block)
  if (cached !== undefined) return cached
  const counts = countReasoningText(block.text)
  blockCache.set(block, counts)
  return counts
}

/**
 * Fold a conversation snapshot into session-wide trajectory stats.
 * @param snapshot - current conversation snapshot (undefined → null result).
 * @returns stats, or null while no session is current.
 */
export function computeStats(snapshot: ConversationSnapshot | undefined): TrajectoryStats | null {
  if (snapshot === undefined) return null

  const patterns = new Array<number>(PATTERNS.length).fill(0)
  const words: WordCounts = { we: 0, lets: 0, letMe: 0, firstPerson: 0 }
  const seen = new Set<AssistantBlock>()
  let blocks = 0
  let chars = 0
  let replies = 0

  const fold = (block: AssistantBlock): void => {
    if (block.kind !== 'reasoning' || seen.has(block)) return
    seen.add(block)
    const counts = blockCounts(block)
    blocks += 1
    chars += counts.chars
    for (let i = 0; i < patterns.length; i++) patterns[i] += counts.patterns[i]
    words.we += counts.words.we
    words.lets += counts.words.lets
    words.letMe += counts.words.letMe
    words.firstPerson += counts.words.firstPerson
  }

  for (const node of snapshot.nodes as readonly ConversationNode[]) {
    if (node.kind !== 'assistant') continue
    replies += 1
    for (const block of node.blocks) fold(block)
  }
  if (snapshot.partial !== null) {
    for (const block of snapshot.partial.blocks) fold(block)
  }

  const groups = {} as Record<Group, number>
  for (const group of GROUPS) {
    let total = 0
    for (let i = 0; i < PATTERNS.length; i++) {
      if (PATTERNS[i].group === group) total += patterns[i]
    }
    groups[group] = total
  }

  const total = groups.efficient + groups.hesitant + groups.neutral
  const shares = {} as Record<Group, number>
  for (const group of GROUPS) shares[group] = total === 0 ? 0 : groups[group] / total

  // Research classifier: any `let me` → hesitant; else bare `we`/`let's` → efficient.
  const mode: Mode = words.letMe > 0
    ? 'hesitant'
    : words.we > 0 || words.lets > 0
      ? 'efficient'
      : 'neutral'

  const denominator = words.we + words.lets + words.letMe
  const hesitation = denominator === 0 ? 0 : words.letMe / denominator

  return {
    blocks,
    chars,
    replies,
    streaming: snapshot.partial !== null,
    groups,
    patterns,
    words,
    shares,
    mode,
    hesitation,
  }
}

/** Human-scale reasoning characters: 12.4K / 1.2M. */
export function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}K`
  return String(value)
}
