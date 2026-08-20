/**
 * Compile-time contract probe for the dsh 0.1.x client face (rc.7, rc.8, later).
 *
 * This file is intentionally not bundled. `pnpm typecheck` compiles it against
 * the installed `@deepseek-ai/dsh-client-*` declarations. Runtime folding is
 * covered by verify.mjs; this file only checks that the host methods we call
 * still exist on the typed faces.
 */

import type {
  ConversationSnapshot, ISessions, SessionFace,
} from '@deepseek-ai/dsh-client-runtime/client'
import { conversationViewOf, type SessionPort, type SessionsPort } from './src/client/conversation.ts'
import type { StatsSnapshot } from './src/client/session-store.ts'

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
