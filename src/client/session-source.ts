/**
 * Live conversation observable for a root-scope overlay entry.
 *
 * `shell.overlay` is root-scoped, so the panel does not receive the
 * framework `useSession` standard prop. This builds a `HostObservable` over
 * the *current* session's `ConversationSnapshot` (via `ctx.sessions.binding`
 * → `SessionFace`, which is `ISession & ObservableSnapshot<ConversationSnapshot>`)
 * and hands it to the component through the register() inject `hooks`
 * compartment as `useConversation`.
 *
 * The observable re-targets whenever the session list's `current` selection
 * changes, and re-notifies on every snapshot publish of the tracked session —
 * including `partial` reasoning deltas, which the session layer throttles to
 * at most one publish per animation frame.
 */

import type { ConversationSnapshot, ISessions } from '@deepseek-ai/dsh-client-runtime/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'

/**
 * Build a session-tracking observable.
 * @param sessions - `ctx.sessions` (client runtime service).
 * @returns an observable of the current session's conversation snapshot.
 */
export function createLiveConversation(
  sessions: ISessions,
): HostObservable<ConversationSnapshot | undefined> {
  const listeners = new Set<() => void>()
  let unsubSession: (() => void) | undefined
  let snapshot: ConversationSnapshot | undefined

  const notify = (): void => {
    for (const fn of [...listeners]) fn()
  }

  // Re-point the tracked session when the list's current selection moves.
  const resubscribe = (): void => {
    unsubSession?.()
    unsubSession = undefined
    const id = sessions.list.getSnapshot().current
    if (id === undefined) {
      snapshot = undefined
      return
    }
    const session = sessions.binding(id)?.session
    if (session === undefined) {
      snapshot = undefined
      return
    }
    snapshot = session.getSnapshot()
    unsubSession = session.subscribe(notify)
  }

  const offList = sessions.list.subscribe(resubscribe)
  resubscribe()

  return {
    getSnapshot: () => snapshot,
    subscribe: (fn) => {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
  }
}
