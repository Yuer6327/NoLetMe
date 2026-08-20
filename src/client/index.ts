/**
 * NoLetMe browser plugin entry — the `exports["./client"]` bundle root.
 */

export { apply, inject } from './apply.ts'
export type { NoLetMeFace, NoLetMePanelProps } from './slots.ts'
export { SessionStatsAccumulator, PERSISTENCE_VERSION } from './accumulator.ts'
export type { PersistedSessionStats } from './accumulator.ts'
export { conversationViewOf } from './conversation.ts'
export type {
  AssistantBlockView, ConversationNodeView, ConversationView, OpenStateView,
  PartialAssistantView, SessionPort, SessionsPort,
} from './conversation.ts'
export { createStatsStore } from './session-store.ts'
export type { HistoryState, StatsSnapshot, StatsStorage } from './session-store.ts'
export {
  CLASSIFIER_VERSION, anomalyOf, computeStats, countBlock, countReasoningText, emptySessionCounts, foldBlock, formatCount, toTrajectoryStats,
} from './stats.ts'
export type {
  BlockCounts, PatternCounts, ReasoningAnomaly, SessionCounts, TrajectoryStats, WordCounts,
} from './stats.ts'
export {
  EFFICIENT_PATTERNS, GROUPS, HESITANT_PATTERNS, KEYWORD_TAXONOMY_VERSION, NEUTRAL_PATTERNS, PATTERNS,
} from './keywords.ts'
export type { Group, KeywordPattern, Mode } from './keywords.ts'
