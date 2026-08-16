/**
 * NoLetMe browser plugin entry — the `exports["./client"]` bundle root.
 */

export { apply, inject } from './apply.ts'
export type { NoLetMeFace, NoLetMePanelProps } from './slots.ts'
export { SessionStatsAccumulator } from './accumulator.ts'
export type { PersistedSessionStats } from './accumulator.ts'
export { createStatsStore } from './session-store.ts'
export type { StatsSnapshot, StatsStorage } from './session-store.ts'
export {
  computeStats, countBlock, countReasoningText, emptySessionCounts, foldBlock, formatCount, toTrajectoryStats,
} from './stats.ts'
export type { BlockCounts, PatternCounts, SessionCounts, TrajectoryStats, WordCounts } from './stats.ts'
export {
  EFFICIENT_PATTERNS, GROUPS, HESITANT_PATTERNS, NEUTRAL_PATTERNS, PATTERNS,
} from './keywords.ts'
export type { Group, KeywordPattern, Mode } from './keywords.ts'
