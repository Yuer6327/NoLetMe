/**
 * Live conversation observable for a root-scope overlay entry.
 *
 * `shell.overlay` is root-scoped, so the panel does not receive the
 * framework `useSession` standard prop. This builds a `HostObservable` over
 * the *current* session's conversation slice (via `ctx.sessions.binding`
 * → session face, plus optional `ctx.uiConversation.binding` on 0.1.2+)
 * and hands it to the consumer through a subscribe/getSnapshot pair.
 *
 * The host snapshot is projected through {@link conversationViewOf}:
 * rc.7–0.1.1 publish `nodes`/`partial` on the session object (with
 * `chat.legacy` as the rc.8 mirror); 0.1.2+ keeps lifecycle on the
 * session object and moves nodes to `uiConversation` `chat.legacy`.
 *
 * The observable re-targets whenever the session list's `current` selection
 * changes and re-notifies on every snapshot publish of the tracked session —
 * including `partial` reasoning deltas, which the session layer throttles to
 * at most one publish per animation frame. When the selection moves to a new
 * session it **notifies immediately** so consumers repaint against the new
 * session's snapshot without waiting for that session to stream.
 *
 * `conversationOf` is retried (bounded) only when the session snapshot does
 * not already carry nodes, so a late-mounting `uiConversation` still
 * attaches on 0.1.2 without polling on rc.7–0.1.1.
 */

import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import {
  conversationViewOf,
  sessionCarriesNodes,
  type ConversationPort,
  type ConversationView,
  type SessionsPort,
} from './conversation.ts'

/** Bounded wait for a late `uiConversation` on 0.1.2 (apply can race assembly). */
const CONVERSATION_RETRY_MS = 50
const CONVERSATION_RETRY_MAX = 40

/**
 * Build a session-tracking observable.
 * @param sessions - `ctx.sessions` (client runtime / session-controller service).
 * @param conversationOf - optional 0.1.2+ `uiConversation.binding(id)` lookup.
 * @returns an observable of the current session's conversation slice.
 */
export function createLiveConversation(
  sessions: SessionsPort,
  conversationOf?: (id: string) => ConversationPort | undefined,
): HostObservable<ConversationView | undefined> {
  const listeners = new Set<() => void>()
  let unsubSession: (() => void) | undefined
  let unsubConversation: (() => void) | undefined
  let conversation: ConversationPort | undefined
  let snapshot: ConversationView | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let retryCount = 0
  let trackedId: string | undefined
  let trackedSession: { getSnapshot(): unknown } | undefined

  const notify = (): void => {
    for (const fn of [...listeners]) fn()
  }

  const lookupConversation = (id: string): ConversationPort | undefined => {
    if (conversationOf === undefined) return undefined
    try {
      return conversationOf(id)
    } catch {
      return undefined
    }
  }

  const project = (session: { getSnapshot(): unknown }): ConversationView | undefined => {
    return conversationViewOf(session.getSnapshot(), conversation?.snapshot.getSnapshot())
  }

  const stopRetry = (): void => {
    if (retryTimer !== undefined) {
      clearTimeout(retryTimer)
      retryTimer = undefined
    }
    retryCount = 0
  }

  const scheduleRetry = (): void => {
    if (retryTimer !== undefined || conversation !== undefined) return
    if (conversationOf === undefined || trackedId === undefined || trackedSession === undefined) return
    if (sessionCarriesNodes(trackedSession.getSnapshot())) return
    if (retryCount >= CONVERSATION_RETRY_MAX) return
    retryTimer = setTimeout(() => {
      retryTimer = undefined
      retryCount += 1
      if (trackedId === undefined || trackedSession === undefined) return
      ensureConversation(trackedId, trackedSession)
      if (conversation !== undefined) notify()
      else scheduleRetry()
    }, CONVERSATION_RETRY_MS)
  }

  const ensureConversation = (id: string, session: { getSnapshot(): unknown }): void => {
    if (conversation !== undefined) {
      snapshot = project(session)
      return
    }
    conversation = lookupConversation(id)
    snapshot = project(session)
    if (conversation === undefined) {
      scheduleRetry()
      return
    }
    stopRetry()
    unsubConversation = conversation.snapshot.subscribe(() => {
      snapshot = project(session)
      notify()
    })
  }

  // Re-point the tracked session when the list's current selection moves.
  const resubscribe = (): void => {
    unsubSession?.()
    unsubSession = undefined
    unsubConversation?.()
    unsubConversation = undefined
    conversation = undefined
    stopRetry()
    trackedId = undefined
    trackedSession = undefined
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
    trackedId = id
    trackedSession = session
    ensureConversation(id, session)
    unsubSession = session.subscribe(() => {
      // SessionFace publishes a notification rather than passing the snapshot.
      // Refresh before notifying so streaming deltas (and a late uiConversation)
      // are visible instead of leaving the store on the first snapshot.
      ensureConversation(id, session)
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
