/**
 * Per-session trajectory accumulator with durable persistence.
 *
 * The accumulator folds assistant reasoning blocks into session counts using a
 * high-water mark over the monotonic `seq` space: nodes whose seq lies OUTSIDE
 * the already-counted [minSeq, maxSeq] range are new (appended messages have
 * higher seq; history paged in via `loadOlder` has lower seq), so a revisit
 * after reload folds only what is new and never re-walks the conversation.
 *
 * Compaction rewrites history under fresh seqs — a new `compaction` node whose
 * seq exceeds the last observed one resets the accumulator and recounts the
 * current window, so compacted sessions never double- or under-count.
 *
 * The block text itself is never recounted: `foldBlock` reuses the WeakMap
 * cache keyed by block identity (`stats.ts`).
 */

import type {
  AssistantMessageNode, ConversationSnapshot,
} from '@deepseek-ai/dsh-client-runtime/client'
import {
  emptySessionCounts, foldBlock, toTrajectoryStats,
  type SessionCounts, type TrajectoryStats,
} from './stats.ts'

/** Serialized form persisted to localStorage. */
export interface PersistedSessionStats {
  v: 1
  minSeq: number
  maxSeq: number
  lastCompactionSeq: number
  counts: SessionCounts
}

/** One session's live accumulator. */
export class SessionStatsAccumulator {
  private minSeq = Number.POSITIVE_INFINITY
  private maxSeq = Number.NEGATIVE_INFINITY
  private lastCompactionSeq = 0
  readonly counts: SessionCounts = emptySessionCounts()

  /**
   * Fold a snapshot into the accumulator. Detects compaction and only counts
   * nodes whose seq is outside the already-counted range.
   * @param snapshot - current conversation snapshot.
   * @returns whether the durable counts changed.
   */
  fold(snapshot: ConversationSnapshot): boolean {
    let maxCompaction = 0
    for (const node of snapshot.nodes) {
      if (node.kind === 'compaction' && node.seq > maxCompaction) maxCompaction = node.seq
    }
    if (maxCompaction > this.lastCompactionSeq) {
      // History rewritten: drop the stale window and recount what is present.
      this.lastCompactionSeq = maxCompaction
      this.resetCounts()
      for (const node of snapshot.nodes) {
        if (node.kind === 'assistant') this.foldNode(node)
      }
      return true
    }

    let changed = false
    for (const node of snapshot.nodes) {
      if (node.kind !== 'assistant') continue
      if (node.seq >= this.minSeq && node.seq <= this.maxSeq) continue
      this.foldNode(node)
      changed = true
    }
    return changed
  }

  /** Trajectory stats for the current snapshot, including live in-flight blocks. */
  toStats(snapshot: ConversationSnapshot): TrajectoryStats {
    const live: SessionCounts = {
      patterns: [...this.counts.patterns],
      words: { ...this.counts.words },
      blocks: this.counts.blocks,
      chars: this.counts.chars,
      replies: this.counts.replies,
    }
    if (snapshot.partial !== null) {
      for (const block of snapshot.partial.blocks) foldBlock(live, block)
    }
    return toTrajectoryStats(live, snapshot.partial !== null)
  }

  /** Whether the accumulator carries any folded data (drives cache reuse). */
  get empty(): boolean {
    return this.counts.replies === 0 && this.counts.blocks === 0
  }

  /** Serialize for durable storage. */
  persist(): PersistedSessionStats {
    return {
      v: 1,
      minSeq: this.minSeq === Number.POSITIVE_INFINITY ? 0 : this.minSeq,
      maxSeq: this.maxSeq === Number.NEGATIVE_INFINITY ? -1 : this.maxSeq,
      lastCompactionSeq: this.lastCompactionSeq,
      counts: {
        patterns: [...this.counts.patterns],
        words: { ...this.counts.words },
        blocks: this.counts.blocks,
        chars: this.counts.chars,
        replies: this.counts.replies,
      },
    }
  }

  /** Rehydrate from durable storage; returns a fresh accumulator on mismatch. */
  static load(data: unknown): SessionStatsAccumulator {
    const acc = new SessionStatsAccumulator()
    if (typeof data !== 'object' || data === null) return acc
    const raw = data as Partial<PersistedSessionStats>
    if (raw.v !== 1) return acc
    const counts = raw.counts
    if (typeof counts !== 'object' || counts === null) return acc
    acc.minSeq = typeof raw.minSeq === 'number' ? raw.minSeq : 0
    acc.maxSeq = typeof raw.maxSeq === 'number' ? raw.maxSeq : -1
    acc.lastCompactionSeq = typeof raw.lastCompactionSeq === 'number' ? raw.lastCompactionSeq : 0
    acc.counts.blocks = Number.isFinite(counts.blocks) ? counts.blocks : 0
    acc.counts.chars = Number.isFinite(counts.chars) ? counts.chars : 0
    acc.counts.replies = Number.isFinite(counts.replies) ? counts.replies : 0
    if (Array.isArray(counts.patterns)) {
      for (let i = 0; i < acc.counts.patterns.length; i++) {
        const value = counts.patterns[i]
        acc.counts.patterns[i] = Number.isFinite(value) ? value : 0
      }
    }
    const words = counts.words
    if (typeof words === 'object' && words !== null) {
      acc.counts.words.we = Number.isFinite(words.we) ? words.we : 0
      acc.counts.words.lets = Number.isFinite(words.lets) ? words.lets : 0
      acc.counts.words.letMe = Number.isFinite(words.letMe) ? words.letMe : 0
      acc.counts.words.firstPerson = Number.isFinite(words.firstPerson) ? words.firstPerson : 0
    }
    return acc
  }

  private foldNode(node: AssistantMessageNode): void {
    this.counts.replies += 1
    for (const block of node.blocks) foldBlock(this.counts, block)
    if (node.seq < this.minSeq) this.minSeq = node.seq
    if (node.seq > this.maxSeq) this.maxSeq = node.seq
  }

  private resetCounts(): void {
    this.minSeq = Number.POSITIVE_INFINITY
    this.maxSeq = Number.NEGATIVE_INFINITY
    const fresh = emptySessionCounts()
    for (let i = 0; i < fresh.patterns.length; i++) this.counts.patterns[i] = 0
    this.counts.words.we = 0
    this.counts.words.lets = 0
    this.counts.words.letMe = 0
    this.counts.words.firstPerson = 0
    this.counts.blocks = 0
    this.counts.chars = 0
    this.counts.replies = 0
  }
}
