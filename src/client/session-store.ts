/**
 * NoLetMe stats store — the durable, incremental, full-history backend.
 *
 * Ties the live conversation observable to a per-session accumulator:
 *
 *  - **Real-time**: every snapshot publish (including streamed `partial`
 *    deltas, at most once per animation frame) folds new nodes incrementally
 *    and republishes the trajectory stats.
 *  - **Session switching**: switching conversations immediately repaints the
 *    new session's stats from its durable cache, then pages the complete
 *    history in via `loadOlder` so the count reflects the whole conversation.
 *  - **Local persistence**: each session's folded counts live in localStorage
 *    (`dsh-noletme.stats.<sessionId>`), so reopening a conversation does not
 *    re-walk its history — only nodes newer than the persisted high-water mark
 *    are folded.
 *
 * Robustness: localStorage failures are swallowed; `loadOlder` paging is
 * capped, error-guarded, and aborted when the user switches away mid-sync;
 * the in-memory session cache is bounded.
 */

import type {
  ConversationSnapshot, ISessions, SessionId, SessionFace,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import { createLiveConversation } from './session-source.ts'
import { SessionStatsAccumulator } from './accumulator.ts'
import type { TrajectoryStats } from './stats.ts'

/** What the panel renders at one instant. */
export interface StatsSnapshot {
  /** Session whose history is being counted; undefined while no session is current. */
  sessionId: SessionId | undefined
  /** Current trajectory stats; null while no session is current. */
  stats: TrajectoryStats | null
  /** True while the complete history is still being paged in. */
  loading: boolean
}

/** Max `loadOlder` pages a full-history sync will pull (robustness bound). */
const MAX_HISTORY_PAGES = 30
/** Debounce for durable writes after a fold. */
const PERSIST_DEBOUNCE_MS = 800
/** In-memory per-session accumulator cache bound. */
const MAX_CACHED_SESSIONS = 24

/** Storage seam (localStorage), defaulting to the browser store. */
export type StatsStorage = Pick<Storage, 'getItem' | 'setItem'>

function storageKey(sessionId: string): string {
  return `dsh-noletme.stats.${sessionId}`
}

/**
 * Build the stats store over the sessions service.
 * @param sessions - `ctx.sessions`.
 * @param storage - durable key/value store (defaults to window.localStorage).
 * @returns a HostObservable the panel consumes as `useStats`.
 */
export function createStatsStore(
  sessions: ISessions,
  storage: StatsStorage = (typeof window === 'undefined' ? undefined : window.localStorage) as StatsStorage,
): HostObservable<StatsSnapshot> {
  const live = createLiveConversation(sessions)
  const listeners = new Set<() => void>()
  const accCache = new Map<string, SessionStatsAccumulator>()

  let currentId: SessionId | undefined
  let acc = new SessionStatsAccumulator()
  let loading = false
  let lastSnap: ConversationSnapshot | undefined
  let loadGen = 0
  let persistTimer: ReturnType<typeof setTimeout> | undefined
  let value: StatsSnapshot = { sessionId: undefined, stats: null, loading: false }

  const notify = (): void => {
    for (const fn of [...listeners]) fn()
  }

  const publish = (): void => {
    value = {
      sessionId: currentId,
      stats: lastSnap === undefined ? null : acc.toStats(lastSnap),
      loading,
    }
    notify()
  }

  const persistNow = (sessionId: string, target: SessionStatsAccumulator): void => {
    if (storage === undefined) return
    try {
      storage.setItem(storageKey(sessionId), JSON.stringify(target.persist()))
    } catch {
      /* private mode / quota: non-fatal */
    }
  }

  const schedulePersist = (): void => {
    if (storage === undefined) return
    if (persistTimer !== undefined) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
      persistTimer = undefined
      if (currentId !== undefined) persistNow(currentId, acc)
    }, PERSIST_DEBOUNCE_MS)
  }

  const readPersisted = (sessionId: string): SessionStatsAccumulator => {
    if (storage === undefined) return new SessionStatsAccumulator()
    try {
      const raw = storage.getItem(storageKey(sessionId))
      return raw === null ? new SessionStatsAccumulator() : SessionStatsAccumulator.load(JSON.parse(raw))
    } catch {
      return new SessionStatsAccumulator()
    }
  }

  /** Page the complete history of a just-focused session into the snapshot. */
  const syncFullHistory = async (sessionId: SessionId, session: SessionFace, gen: number): Promise<void> => {
    loading = true
    publish()
    let pages = 0
    try {
      while (pages < MAX_HISTORY_PAGES && gen === loadGen) {
        if (sessions.list.getSnapshot().current !== sessionId) break
        const snap = live.getSnapshot()
        if (snap === undefined || snap.sessionId !== sessionId) break
        if (snap.openState !== 'open' || !snap.hasMore || snap.loadingOlder) break
        await session.loadOlder()
        pages += 1
        // Let the republished snapshot land before re-reading hasMore.
        await new Promise(resolve => setTimeout(resolve, 0))
      }
    } catch {
      /* robustness: a paging failure just stops the sync */
    }
    if (gen !== loadGen) return // user switched away; a newer sync owns `loading`
    loading = false
    publish()
  }

  const switchTo = (sessionId: SessionId): void => {
    if (currentId !== undefined) persistNow(currentId, acc)
    currentId = sessionId
    let cached = accCache.get(sessionId)
    if (cached === undefined) {
      cached = readPersisted(sessionId)
      accCache.set(sessionId, cached)
      if (accCache.size > MAX_CACHED_SESSIONS) {
        const oldest = accCache.keys().next().value as string | undefined
        if (oldest !== undefined) accCache.delete(oldest)
      }
    }
    acc = cached
    loadGen += 1
    const gen = loadGen
    const session = sessions.binding(sessionId)?.session
    if (session !== undefined) void syncFullHistory(sessionId, session, gen)
  }

  const onLive = (): void => {
    const snap = live.getSnapshot()
    lastSnap = snap
    if (snap === undefined) {
      if (currentId !== undefined) persistNow(currentId, acc)
      currentId = undefined
      acc = new SessionStatsAccumulator()
      loading = false
      publish()
      return
    }
    if (snap.sessionId !== currentId) switchTo(snap.sessionId)
    const changed = acc.fold(snap)
    if (changed) schedulePersist()
    publish()
  }

  const offLive = live.subscribe(onLive)
  onLive()

  return {
    getSnapshot: () => value,
    subscribe: (fn) => {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
  }
}
