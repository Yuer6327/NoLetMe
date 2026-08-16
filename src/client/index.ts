/**
 * NoLetMe browser plugin entry — the `exports["./client"]` bundle root.
 */

export { apply, inject } from './apply.ts'
export type { NoLetMeFace, NoLetMePanelProps } from './slots.ts'
export { computeStats, countReasoningText } from './stats.ts'
export type { TrajectoryStats } from './stats.ts'
export {
  EFFICIENT_PATTERNS, GROUPS, HESITANT_PATTERNS, NEUTRAL_PATTERNS, PATTERNS,
} from './keywords.ts'
export type { Group, KeywordPattern, Mode } from './keywords.ts'
