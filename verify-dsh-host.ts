/**
 * Compile-time contract probe for the dsh 0.1.x client face (rc.7, rc.8, later).
 *
 * This file is intentionally not bundled. `pnpm typecheck` compiles it against
 * the installed `@deepseek-ai/dsh-client-*` declarations. Runtime folding is
 * covered by verify.mjs; this file only checks that the host methods we call
 * still exist on the typed faces.
 */

import { conversationViewOf, type SessionPort, type SessionsPort } from './src/client/conversation.ts'
import type { StatsSnapshot } from './src/client/session-store.ts'

/**
 * Structural host faces. Through 0.1.1 these lived on
 * `@deepseek-ai/dsh-client-runtime/client`; 0.1.2 deleted that package and
 * split them across `dsh-api-session-controller` (ISessions / SessionFace)
 * and `dsh-client-ui-conversation` (ConversationSnapshot). The probe stays
 * structural so it typechecks against either lock without pulling the whole
 * 0.1.2 peer tree.
 */
interface ConversationSnapshot {
  readonly sessionId: string
  readonly nodes: readonly { readonly kind: string; readonly seq: number }[]
  readonly partial: { readonly blocks: readonly unknown[] } | null
  readonly openState?: string
  readonly hasMore?: boolean
  readonly loadingOlder?: boolean
}

interface SessionFace {
  getSnapshot(): unknown
  subscribe(fn: () => void): () => void
  loadOlder(): Promise<void>
}

interface ISessions {
  readonly list: {
    getSnapshot(): { readonly current?: string }
    subscribe(fn: () => void): () => void
  }
  binding(id: string): { readonly session: SessionFace } | undefined
}

// Public consumers compiled against the pre-versioned store can still provide
// the original shape; newly added history fields remain optional at the seam.
const legacyStatsSnapshot: StatsSnapshot = {
  sessionId: undefined,
  stats: null,
  loading: false,
}
void legacyStatsSnapshot

/** The host session face must remain a structural SessionPort. */
export function verifyHostSession(session: Pick<SessionFace, 'getSnapshot' | 'subscribe' | 'loadOlder'>): SessionPort {
  const view = conversationViewOf(session.getSnapshot())
  void view?.openState
  void view?.hasMore
  void view?.loadingOlder
  void view?.nodes
  void view?.partial
  const unsubscribe = session.subscribe(() => {
    void conversationViewOf(session.getSnapshot())
  })
  unsubscribe()
  void session.loadOlder()
  return session
}

/** The host sessions service must remain a structural SessionsPort. */
export function verifyHostSessions(sessions: Pick<ISessions, 'list' | 'binding'>): SessionsPort {
  const current = sessions.list.getSnapshot().current
  if (current !== undefined) {
    const session = sessions.binding(current)?.session
    if (session !== undefined) verifyHostSession(session)
  }
  return sessions
}

/** rc.7 / rc.8 top-level compatibility slice is enough to count. */
export function verifyTopLevelSlice(snapshot: ConversationSnapshot): void {
  const view = conversationViewOf(snapshot)
  if (view === undefined) throw new Error('host snapshot missing sessionId')
  void view.nodes
  void view.partial
}

/** A later host that only publishes `chat.legacy` is still countable. */
export function verifyLegacyChatSlice(snapshot: {
  sessionId: string
  chat: { legacy: { nodes: ConversationSnapshot['nodes']; partial: ConversationSnapshot['partial'] } }
}): void {
  const view = conversationViewOf(snapshot)
  if (view === undefined) throw new Error('legacy chat slice missing sessionId')
  void view.nodes
  void view.partial
}

/**
 * 0.1.2+ split: SessionFace is lifecycle-only; nodes live on
 * `uiConversation` `views.get('chat').legacy`. Typed structurally so the
 * probe compiles without `@deepseek-ai/dsh-client-runtime` (deleted in 0.1.2).
 */
export function verifySplitConversationSlice(
  session: Pick<ConversationSnapshot, 'sessionId'> & { openState: string; hasMore: boolean; loadingOlder: boolean },
  conversation: {
    views: {
      get(target: 'chat'): { legacy: { nodes: ConversationSnapshot['nodes']; partial: ConversationSnapshot['partial'] } }
    }
  },
): void {
  const view = conversationViewOf(session, conversation)
  if (view === undefined) throw new Error('split conversation slice missing sessionId')
  void view.nodes
  void view.partial
  void view.openState
}
