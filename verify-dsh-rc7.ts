/**
 * Compile-time contract probe for the dsh 0.1.0-rc.7 client face.
 *
 * This file is intentionally not bundled. `pnpm typecheck` compiles it against
 * the pinned rc.7 declarations so changes to the host contract fail CI before
 * a plugin release. Runtime behavior is covered by verify.mjs mocks.
 */

import type {
  ConversationSnapshot, ISessions, SessionFace,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { StatsSnapshot } from './src/client/session-store.ts'

// Public consumers compiled against the pre-versioned store can still provide
// the original shape; newly added history fields remain optional at the seam.
const legacyStatsSnapshot: StatsSnapshot = {
  sessionId: undefined,
  stats: null,
  loading: false,
}
void legacyStatsSnapshot

export function verifyDshRc7Session(session: Pick<SessionFace, 'getSnapshot' | 'subscribe' | 'loadOlder'>): void {
  const snapshot: ConversationSnapshot = session.getSnapshot()
  const openState: ConversationSnapshot['openState'] = snapshot.openState
  const hasMore: boolean = snapshot.hasMore
  const loadingOlder: boolean = snapshot.loadingOlder
  void openState
  void hasMore
  void loadingOlder

  const unsubscribe = session.subscribe(() => {
    const next: ConversationSnapshot = session.getSnapshot()
    void next
  })
  unsubscribe()
  void session.loadOlder()
}

export function verifyDshRc7Sessions(sessions: Pick<ISessions, 'list' | 'binding'>): void {
  const current = sessions.list.getSnapshot().current
  if (current === undefined) return
  const session = sessions.binding(current)?.session
  if (session !== undefined) verifyDshRc7Session(session)
}
