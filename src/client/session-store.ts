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
import { PERSISTENCE_VERSION, SessionStatsAccumulator } from './accumulator.ts'
import type { TrajectoryStats } from './stats.ts'

/** State of the full-history synchronization for the current session. */
export type HistoryState = 'idle' | 'syncing' | 'complete' | 'limited' | 'error'

/** What the panel renders at one instant. */
export interface StatsSnapshot {
  /** Session whose history is being counted; undefined while no session is current. */
  sessionId: SessionId | undefined
  /** Current trajectory stats; null while no session is current. */
  stats: TrajectoryStats | null
  /** True while the complete history is still being paged in. */
  loading: boolean
  /** Explicit result of the full-history synchronization (optional for old consumers). */
  historyState?: HistoryState
  /** Number of older pages loaded during the current synchronization. */
  historyPages?: number
  /** Configured page cap, useful when explaining a `limited` result. */
  historyLimit?: number
  /** Stable, non-sensitive error code when history loading fails. */
  historyError?: 'load-failed' | 'session-unavailable'
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
  return `dsh-noletme.stats.v${PERSISTENCE_VERSION}.${sessionId}`
}

/** Key used by 0.1.2 and earlier; retained for one-way migration. */
function legacyStorageKey(sessionId: string): string {
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
  let historyState: HistoryState = 'idle'
  let historyPages = 0
  let historyError: StatsSnapshot['historyError']
  let historySyncRunning = false
  let lastSnap: ConversationSnapshot | undefined
  let loadGen = 0
  let persistTimer: ReturnType<typeof setTimeout> | undefined
  let value: StatsSnapshot = {
    sessionId: undefined,
    stats: null,
    loading: false,
    historyState: 'idle',
    historyPages: 0,
    historyLimit: MAX_HISTORY_PAGES,
  }

  const notify = (): void => {
    for (const fn of [...listeners]) fn()
  }

  const publish = (): void => {
    value = {
      sessionId: currentId,
      stats: lastSnap === undefined ? null : acc.toStats(lastSnap),
      loading,
      historyState,
      historyPages,
      historyLimit: MAX_HISTORY_PAGES,
      ...(historyError === undefined ? {} : { historyError }),
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
    const keys = [storageKey(sessionId), legacyStorageKey(sessionId)]
    for (const key of keys) {
      let raw: string | null
      try {
        raw = storage.getItem(key)
      } catch {
        continue
      }
      if (raw === null) continue
      try {
        const parsed: unknown = JSON.parse(raw)
        const version = typeof parsed === 'object' && parsed !== null
          ? (parsed as { v?: unknown }).v
          : undefined
        if (version !== 1 && version !== PERSISTENCE_VERSION) continue
        const loaded = SessionStatsAccumulator.load(parsed)
        // A valid legacy v1 record is rewritten under the versioned key. The
        // old key is intentionally left intact because StatsStorage may not
        // expose removeItem and other plugin versions may still use it.
        if (key === legacyStorageKey(sessionId)
          && typeof parsed === 'object' && parsed !== null
          && (parsed as { v?: unknown }).v === 1) {
          try { storage.setItem(storageKey(sessionId), JSON.stringify(loaded.persist())) } catch { /* best effort */ }
        }
        return loaded
      } catch {
        /* Try the legacy key if the current record is corrupt. */
      }
    }
    return new SessionStatsAccumulator()
  }

  /** Page the complete history of a just-focused session into the snapshot. */
  const syncFullHistory = async (sessionId: SessionId, session: SessionFace, gen: number): Promise<void> => {
    if (historySyncRunning) return
    historySyncRunning = true
    loading = true
    historyState = 'syncing'
    historyError = undefined
    publish()
    let pages = historyPages
    let failed = false
    let waitingForOpen = false
    try {
      while (pages < MAX_HISTORY_PAGES && gen === loadGen) {
        if (sessions.list.getSnapshot().current !== sessionId) {
          waitingForOpen = true
          break
        }
        const snap = live.getSnapshot()
        if (snap === undefined || snap.sessionId !== sessionId) {
          waitingForOpen = true
          break
        }
        if (snap.openState === 'error') {
          failed = true
          break
        }
        if (snap.openState !== 'open' || snap.loadingOlder) {
          // A selected rc7 session can be cold/loading while the host opens it.
          // Keep the state syncing and retry when the session publishes again;
          // never turn this transient state into a false `limited` result.
          waitingForOpen = true
          break
        }
        if (!snap.hasMore) break
        await session.loadOlder()
        pages += 1
        historyPages = pages
        publish()
        // Let the republished snapshot land before re-reading hasMore.
        await new Promise(resolve => setTimeout(resolve, 0))
      }
    } catch {
      failed = true
    }
    if (gen !== loadGen) return // user switched away; a newer sync owns the state

    historySyncRunning = false
    const finalSnap = live.getSnapshot()
    const stillHasMore = finalSnap?.sessionId === sessionId && finalSnap.hasMore === true
    if (waitingForOpen) {
      // Remain visibly syncing. onLive will retry once the same session changes
      // from cold/loading to open (or finishes an external older-page request).
      loading = true
      historyState = 'syncing'
      publish()
      return
    }
    loading = false
    if (failed || finalSnap?.openState === 'error') {
      historyState = 'error'
      historyError = 'load-failed'
    } else if (stillHasMore) {
      // Do not present an unavailable or page-capped result as complete.
      historyState = 'limited'
    } else {
      historyState = 'complete'
    }
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
    historyState = 'syncing'
    historyPages = 0
    historyError = undefined
    const session = sessions.binding(sessionId)?.session
    if (session !== undefined) void syncFullHistory(sessionId, session, gen)
    else {
      historySyncRunning = false
      loading = false
      historyState = 'error'
      historyError = 'session-unavailable'
    }
  }

  const onLive = (): void => {
    const snap = live.getSnapshot()
    lastSnap = snap
    if (snap === undefined) {
      if (currentId !== undefined) persistNow(currentId, acc)
      currentId = undefined
      acc = new SessionStatsAccumulator()
      loading = false
      historySyncRunning = false
      historyState = 'idle'
      historyPages = 0
      historyError = undefined
      publish()
      return
    }
    if (snap.sessionId !== currentId) switchTo(snap.sessionId)
    else if (historyState === 'syncing' && !historySyncRunning) {
      // A cold/loading session will ask us to retry after its next snapshot.
      const session = sessions.binding(snap.sessionId)?.session
      if (session !== undefined) void syncFullHistory(snap.sessionId, session, loadGen)
    }
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
