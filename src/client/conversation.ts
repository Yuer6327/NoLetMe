/**
 * Host-conversation structural face.
 *
 * NoLetMe only needs a handful of snapshot fields (`sessionId`, assistant
 * reasoning/text blocks, compaction seq, history-open flags). Those fields
 * have moved across 0.1.x hosts:
 *
 *  - 0.1.0-rc.7 / rc.8 / 0.1.1-rc.x: `nodes` / `partial` / `openState` live on
 *    the Session snapshot (`dsh-client-runtime`). rc.8 also mirrors them at
 *    `chat.legacy`.
 *  - 0.1.2-rc.1 / 0.1.3-alpha.x / 0.1.5-rc.x / 0.1.6-alpha.1 / 0.1.7-rc.1:
 *    `dsh-client-runtime` is gone. SessionFace is lifecycle-only (`openState` /
 *    `hasMore` / `loadOlder`). Conversation nodes are assembled by
 *    `uiConversation` and published as `views.get('chat').legacy` (0.1.6 added
 *    `turnTimings` / `turnEnds` beside `nodes` / `partial`; the counting slice
 *    is unchanged and 0.1.7 did not touch it).
 *
 * Reading the slice structurally — and merging a separate conversation
 * snapshot when the session object no longer carries nodes — keeps the plugin
 * loading on both hosts.
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

/** History-open lifecycle values observed on rc.7 / rc.8 / 0.1.2. Unknown strings stay opaque. */
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

/**
 * 0.1.2+ conversation assembly face (`ctx.uiConversation.binding(id)`).
 * Optional: rc.7–0.1.1 hosts have no such service; nodes stay on SessionFace.
 */
export interface ConversationPort {
  readonly snapshot: {
    getSnapshot(): unknown
    subscribe(fn: () => void): () => void
  }
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

function chatFromViews(views: unknown): unknown {
  if (views == null) return undefined
  if (typeof (views as { get?: unknown }).get === 'function') {
    try {
      return (views as { get: (target: string) => unknown }).get('chat')
    } catch {
      return undefined
    }
  }
  return isRecord(views) ? views.chat : undefined
}

/**
 * Compatibility `legacy` slice: `chat.legacy` on a session snapshot, or
 * `views.get('chat').legacy` / `{ legacy }` on a conversation snapshot.
 */
function legacySlice(source: unknown): Record<string, unknown> | undefined {
  if (!isRecord(source)) return undefined
  if (isRecord(source.chat) && isRecord(source.chat.legacy)) return source.chat.legacy
  const chat = chatFromViews(source.views)
  if (isRecord(chat) && isRecord(chat.legacy)) return chat.legacy
  if (isRecord(source.legacy)) return source.legacy
  return undefined
}

/**
 * True when the session snapshot already carries the counting slice
 * (rc.7–0.1.1). False on 0.1.2 lifecycle-only SessionFace — callers then
 * wait for `uiConversation`.
 */
export function sessionCarriesNodes(snapshot: unknown): boolean {
  if (!isRecord(snapshot)) return false
  if (asNodes(snapshot.nodes) !== undefined) return true
  return legacySlice(snapshot) !== undefined
}

/**
 * Project a host snapshot onto the counting slice.
 *
 * Prefers the top-level compatibility fields (`nodes`, `partial`, `openState`,
 * `hasMore`, `loadingOlder`). When those are gone, uses `chat.legacy` on the
 * session snapshot, then the optional 0.1.2 conversation snapshot
 * (`views.get('chat').legacy`). Returns undefined when the value is not a
 * session snapshot (no `sessionId`).
 */
export function conversationViewOf(
  snapshot: unknown,
  conversation?: unknown,
): ConversationView | undefined {
  if (!isRecord(snapshot) || typeof snapshot.sessionId !== 'string') return undefined

  const legacy = legacySlice(snapshot) ?? legacySlice(conversation)

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
