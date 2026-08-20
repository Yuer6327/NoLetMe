/**
 * Host-conversation structural face.
 *
 * NoLetMe only needs a handful of snapshot fields (`sessionId`, assistant
 * reasoning/text blocks, compaction seq, history-open flags). Those fields are
 * the documented compatibility slice on dsh 0.1.0-rc.7 and 0.1.0-rc.8
 * (`nodes` / `partial` remain on the snapshot even after rc.8 introduced
 * `chat` / `views`). Reading them structurally — and falling back to
 * `chat.legacy` when the top-level slice is gone — keeps the plugin loading
 * on both hosts and on later 0.1.x releases that preserve either shape.
 */

/** One assistant content block as far as counting is concerned. */
export interface AssistantBlockView {
  readonly kind: string
  readonly text?: string
}

/** One conversation node as far as counting and compaction reset are concerned. */
export interface ConversationNodeView {
  readonly kind: string
  readonly seq: number
  readonly blocks?: readonly AssistantBlockView[]
}

/** In-flight assistant output. */
export interface PartialAssistantView {
  readonly blocks: readonly AssistantBlockView[]
}

/** History-open lifecycle values observed on rc.7 / rc.8. Unknown strings stay opaque. */
export type OpenStateView = 'cold' | 'loading' | 'open' | 'error' | (string & {})

/**
 * The conversation slice NoLetMe actually folds. Optional history flags are
 * filled with conservative defaults when a future host omits them:
 * missing `openState` → already open; missing `hasMore` → nothing to page.
 */
export interface ConversationView {
  readonly sessionId: string
  readonly nodes: readonly ConversationNodeView[]
  readonly partial: PartialAssistantView | null
  readonly openState: OpenStateView
  readonly hasMore: boolean
  readonly loadingOlder: boolean
}

/** Per-session host face used to page history. */
export interface SessionPort {
  getSnapshot(): unknown
  subscribe(fn: () => void): () => void
  loadOlder(): Promise<void>
}

/** `ctx.sessions` subset used by the live conversation observable. */
export interface SessionsPort {
  readonly list: {
    getSnapshot(): { readonly current?: string }
    subscribe(fn: () => void): () => void
  }
  binding(id: string): { readonly session: SessionPort } | undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function asNodes(value: unknown): readonly ConversationNodeView[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value as readonly ConversationNodeView[]
}

function asPartial(value: unknown): PartialAssistantView | null | undefined {
  if (value === null) return null
  if (!isRecord(value) || !Array.isArray(value.blocks)) return undefined
  return { blocks: value.blocks as readonly AssistantBlockView[] }
}

function asOpenState(value: unknown): OpenStateView | undefined {
  return typeof value === 'string' ? value : undefined
}

/**
 * Project a host snapshot onto the counting slice.
 *
 * Prefers the top-level compatibility fields (`nodes`, `partial`, `openState`,
 * `hasMore`, `loadingOlder`). When a later host drops those, the rc.8
 * `chat.legacy` mirror is used instead. Returns undefined when the value is
 * not a session snapshot (no `sessionId`).
 */
export function conversationViewOf(snapshot: unknown): ConversationView | undefined {
  if (!isRecord(snapshot) || typeof snapshot.sessionId !== 'string') return undefined

  const chat = isRecord(snapshot.chat) ? snapshot.chat : undefined
  const legacy = chat !== undefined && isRecord(chat.legacy) ? chat.legacy : undefined

  const nodes = asNodes(snapshot.nodes) ?? asNodes(legacy?.nodes) ?? []
  const topPartial = asPartial(snapshot.partial)
  const partial = topPartial !== undefined
    ? topPartial
    : (asPartial(legacy?.partial) ?? null)
  const openState = asOpenState(snapshot.openState)
    ?? asOpenState(legacy?.openState)
    ?? 'open'
  const hasMore = typeof snapshot.hasMore === 'boolean'
    ? snapshot.hasMore
    : legacy?.hasMore === true
  const loadingOlder = typeof snapshot.loadingOlder === 'boolean'
    ? snapshot.loadingOlder
    : legacy?.loadingOlder === true

  return {
    sessionId: snapshot.sessionId,
    nodes,
    partial,
    openState,
    hasMore,
    loadingOlder,
  }
}
