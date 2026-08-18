/**
 * NoLetMe keyword taxonomy.
 *
 * The model's reasoning blocks are fingerprinted by the words they open and
 * repeat. The list below is grounded in the public trajectory analysis of the
 * DeepSeek V4 Pro GA 0813 post-training overfitting event, in which the RL
 * checkpoints trained on DeepSeek Harness's "Minimal" preset (the "exact RL
 * prompt and schemas" two-tool scaffold) collapse on the wider Standard tool
 * catalog. Cross-harness trajectory evidence (Project2 V4.1b, xiaobright/
 * modeltest docs/v4.1, 2026-08-14) separates two stable fingerprints:
 *
 *   | trajectory          | we   | let me | let's | p50 block | visible replies |
 *   |--------------------|------|--------|-------|-----------|-----------------|
 *   | minimal (99/96)     | 272/231 | 0/0 | 101/117 | 235/239  |       1         |
 *   | anchored (98/99)    | 179/165 | 1/0 |  88/98 | 111/144  |       1         |
 *   | standard (91)       |  11  |  208   |   2   |   437     |      55         |
 *   | PTC (92)            |  16  |  194   |   0   |   550     |      33         |
 *
 * The trigger-mechanism probes record the Standard-catalog opening
 * `The user wants … Let me …`, the Minimal/anchored opening `We need …` /
 * `Need …`, and a conservative lexical classifier: first-line `We need` with
 * bare `we` and no `let me` scores `minimal-like`; any `let me` scores
 * `standard-like`; everything else is ambiguous.
 *
 * Three categories follow from that evidence:
 *
 *  - `efficient` — direct-action framing (`We need …`, `Let's …`, bare `we`),
 *    the high-scoring trajectory fingerprint.
 *  - `hesitant`  — first-person deliberation (`Let me …`, `I think …`,
 *    hedging), the low-scoring trajectory fingerprint.
 *  - `neutral`   — reflective task description (`The user wants …`), the
 *    Standard-catalog opening frame and general other-mode vocabulary.
 */

import type { NoLetMeKey } from './locales.ts'

/** Version of the keyword taxonomy used by persisted and exported evidence. */
export const KEYWORD_TAXONOMY_VERSION = 1 as const

/** Reasoning-trajectory category. */
export type Mode = 'efficient' | 'hesitant' | 'neutral'

/** Every category is also a display group of the panel. */
export type Group = Mode

/** Ordered category list (display order in the panel). */
export const GROUPS: readonly Group[] = ['efficient', 'hesitant', 'neutral']

/** One countable keyword pattern. */
export interface KeywordPattern {
  /** Lowercased tokens that must appear consecutively in one reasoning block. */
  tokens: readonly string[]
  /** Locale key for the human label. */
  label: NoLetMeKey
  /** Category the pattern belongs to. */
  group: Group
  /** Match only at the very first token of a reasoning block (first-line openers). */
  blockStart?: boolean
  /** Short research note rendered as a tooltip/title. */
  note?: string
}

/**
 * Efficient ("We need …" / "Let's …") vocabulary — direct-action, high-score.
 * `we` / `let's` / `we need` are the strongest minimal-trajectory fingerprints;
 * standalone `Good.` / `Great.` / `Excellent.` first lines are the weak
 * affirmation markers (28/16 blocks in the two minimal runs).
 */
export const EFFICIENT_PATTERNS: readonly KeywordPattern[] = [
  { tokens: ['we', 'need'], label: 'pattern.weNeed', group: 'efficient', note: 'trajectory: direct-action opener (minimal/anchored runs)' },
  { tokens: ['we', 'should'], label: 'pattern.weShould', group: 'efficient', note: 'trajectory: collective action frame' },
  { tokens: ['we', 'can'], label: 'pattern.weCan', group: 'efficient', note: 'trajectory: collective capability frame' },
  { tokens: ['we', 'will'], label: 'pattern.weWill', group: 'efficient', note: 'trajectory: collective commitment frame' },
  { tokens: ["let's"], label: 'pattern.lets', group: 'efficient', note: 'trajectory: high-scoring runs carry 88–117' },
  { tokens: ['good'], label: 'pattern.good', group: 'efficient', blockStart: true, note: 'trajectory: standalone first-line affirmation' },
  { tokens: ['great'], label: 'pattern.great', group: 'efficient', blockStart: true, note: 'trajectory: standalone first-line affirmation' },
  { tokens: ['excellent'], label: 'pattern.excellent', group: 'efficient', blockStart: true, note: 'trajectory: standalone first-line affirmation' },
]

/**
 * Hesitant ("Let me …") vocabulary — first-person deliberation, low-score.
 * `let me` is the dominant fingerprint: zero in the two minimal runs, 194–249
 * in Standard/PTC (a single occurrence across 355 anchored blocks was
 * noteworthy). `I`/`I'm`/`I'll` and hedging words are secondary signals.
 */
export const HESITANT_PATTERNS: readonly KeywordPattern[] = [
  { tokens: ['let', 'me'], label: 'pattern.letMe', group: 'hesitant', note: 'trajectory: hesitation marker (standard-like)' },
  { tokens: ['i', 'think'], label: 'pattern.iThink', group: 'hesitant', note: 'trajectory: first-person deliberation' },
  { tokens: ["i'm", 'not', 'sure'], label: 'pattern.imNotSure', group: 'hesitant', note: 'trajectory: uncertainty' },
  { tokens: ["i'm", 'not', 'certain'], label: 'pattern.imNotCertain', group: 'hesitant', note: 'trajectory: uncertainty' },
  { tokens: ['i', 'wonder'], label: 'pattern.iWonder', group: 'hesitant', note: 'trajectory: rumination' },
  { tokens: ['i', 'guess'], label: 'pattern.iGuess', group: 'hesitant', note: 'trajectory: hedged deliberation' },
  { tokens: ['i', 'should'], label: 'pattern.iShould', group: 'hesitant', note: 'trajectory: first-person obligation' },
  { tokens: ['maybe'], label: 'pattern.maybe', group: 'hesitant', note: 'trajectory: hedging' },
  { tokens: ['perhaps'], label: 'pattern.perhaps', group: 'hesitant', note: 'trajectory: hedging' },
]

/**
 * Neutral ("The user wants …") vocabulary — reflective task framing. The
 * Standard-catalog probe opened with `The user wants … Let me …`; the
 * user-address frame is the "other" mode between the two extremes.
 */
export const NEUTRAL_PATTERNS: readonly KeywordPattern[] = [
  { tokens: ['the', 'user', 'wants'], label: 'pattern.userWants', group: 'neutral', note: 'trajectory: Standard-catalog opening frame' },
  { tokens: ['the', 'user', 'asked'], label: 'pattern.userAsked', group: 'neutral', note: 'trajectory: reflective framing' },
  { tokens: ['the', 'user', 'is', 'asking'], label: 'pattern.userIsAsking', group: 'neutral', note: 'trajectory: reflective framing' },
  { tokens: ['the', 'user', 'needs'], label: 'pattern.userNeeds', group: 'neutral', note: 'trajectory: reflective framing' },
  { tokens: ['the', 'user', 'would', 'like'], label: 'pattern.userWouldLike', group: 'neutral', note: 'trajectory: reflective framing' },
  { tokens: ['this', 'task'], label: 'pattern.thisTask', group: 'neutral', note: 'trajectory: task description frame' },
  { tokens: ['the', 'request'], label: 'pattern.theRequest', group: 'neutral', note: 'trajectory: task description frame' },
]

/** Every pattern in display order (group-major). */
export const PATTERNS: readonly KeywordPattern[] = [
  ...EFFICIENT_PATTERNS,
  ...HESITANT_PATTERNS,
  ...NEUTRAL_PATTERNS,
]

/** Patterns belonging to one category. */
export const PATTERNS_BY_GROUP: Readonly<Record<Group, readonly KeywordPattern[]>> = {
  efficient: EFFICIENT_PATTERNS,
  hesitant: HESITANT_PATTERNS,
  neutral: NEUTRAL_PATTERNS,
}

/** Precomputed pattern indices: longest first, ties keep declaration order. */
const ORDERED = PATTERNS
  .map((pattern, index) => ({ index, len: pattern.tokens.length, start: pattern.blockStart === true }))
  .sort((a, b) => b.len - a.len || a.index - b.index)

/** Pattern order at the first token of a block (block-start openers eligible). */
export const FIRST_TOKEN_ORDER: readonly number[] = ORDERED.map(entry => entry.index)

/** Pattern order after the first token (block-start openers ineligible). */
export const LATER_TOKEN_ORDER: readonly number[] = ORDERED
  .filter(entry => !entry.start)
  .map(entry => entry.index)
