/**
 * Live conversation observable for a root-scope overlay entry.
 *
 * `shell.overlay` is root-scoped, so the panel does not receive the
 * framework `useSession` standard prop. This builds a `HostObservable` over
 * the *current* session's conversation slice (via `ctx.sessions.binding`
 * → session face) and hands it to the consumer through a subscribe/getSnapshot
 * pair.
 *
 * The host snapshot is projected through {@link conversationViewOf}: the
 * counting fields (`nodes`/`partial`/`openState`/`hasMore`) are the
 * documented compatibility slice on rc.7 and rc.8; if a later host drops the
 * top-level fields, `chat.legacy` is used instead.
 *
 * The observable re-targets whenever the session list's `current` selection
 * changes and re-notifies on every snapshot publish of the tracked session —
 * including `partial` reasoning deltas, which the session layer throttles to
 * at most one publish per animation frame. When the selection moves to a new
 * session it **notifies immediately** so consumers repaint against the new
 * session's snapshot without waiting for that session to stream.
 */

import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import { conversationViewOf, type ConversationView, type SessionsPort } from './conversation.ts'

/**
 * Build a session-tracking observable.
 * @param sessions - `ctx.sessions` (client runtime service).
 * @returns an observable of the current session's conversation slice.
 */
export function createLiveConversation(
  sessions: SessionsPort,
): HostObservable<ConversationView | undefined> {
  const listeners = new Set<() => void>()
  let unsubSession: (() => void) | undefined
  let snapshot: ConversationView | undefined

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
      notify() // consumers must repaint to the no-session state immediately
      return
    }
    const session = sessions.binding(id)?.session
    if (session === undefined) {
      snapshot = undefined
      notify()
      return
    }
    snapshot = conversationViewOf(session.getSnapshot())
    unsubSession = session.subscribe(() => {
      // SessionFace publishes a notification rather than passing the snapshot.
      // Refresh the value before notifying consumers so streaming deltas are
      // visible to the stats store instead of leaving it on the first snapshot.
      snapshot = conversationViewOf(session.getSnapshot())
      notify()
    })
    notify() // selection moved: repaint now, before the new session publishes
  }

  const offList = sessions.list.subscribe(resubscribe)
  void offList
  resubscribe()

  return {
    getSnapshot: () => snapshot,
    subscribe: (fn) => {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
  }
}
