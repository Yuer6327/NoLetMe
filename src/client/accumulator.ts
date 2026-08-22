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

import type { ConversationNodeView, ConversationView } from './conversation.ts'
import { probeGraySession } from './graytest.ts'
import {
  CLASSIFIER_VERSION, emptySessionCounts, foldBlock, toTrajectoryStats,
  type SessionCounts, type TrajectoryStats,
} from './stats.ts'
import { KEYWORD_TAXONOMY_VERSION } from './keywords.ts'

/** Version of the persisted accumulator schema. */
export const PERSISTENCE_VERSION = 2 as const

/** Shared serialized accumulator fields from every persisted schema. */
interface PersistedSessionStatsFields {
  minSeq: number
  maxSeq: number
  lastCompactionSeq: number
  counts: SessionCounts
  /** Visible-text diagnostic totals (never word-counted). */
  textBlocks: number
  textChars: number
}

/** The schema written by the previous release; retained for migration. */
export interface LegacyPersistedSessionStats extends PersistedSessionStatsFields {
  v: 1
}

/** The current versioned schema written to localStorage. */
export interface VersionedPersistedSessionStats extends PersistedSessionStatsFields {
  v: typeof PERSISTENCE_VERSION
  taxonomyVersion: typeof KEYWORD_TAXONOMY_VERSION
  classifierVersion: typeof CLASSIFIER_VERSION
}

/** Accepted persisted schemas. v1 is read and migrated to the current schema. */
export type PersistedSessionStats = LegacyPersistedSessionStats | VersionedPersistedSessionStats

/** Read a finite persisted number, defaulting malformed values to zero. */
function finiteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** One session's live accumulator. */
export class SessionStatsAccumulator {
  private minSeq = Number.POSITIVE_INFINITY
  private maxSeq = Number.NEGATIVE_INFINITY
  private lastCompactionSeq = 0
  /** Folded reasoning counts (the only surface word-counted). */
  readonly counts: SessionCounts = emptySessionCounts()
  /** Visible-text diagnostic totals — block count + characters only. */
  private textBlocks = 0
  private textChars = 0

  /**
   * Fold a snapshot into the accumulator. Detects compaction and only counts
   * nodes whose seq is outside the already-counted range.
   * @param snapshot - current conversation snapshot.
   * @returns whether the durable counts changed.
   */
  fold(snapshot: ConversationView): boolean {
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
  toStats(snapshot: ConversationView): TrajectoryStats {
    const live: SessionCounts = {
      patterns: [...this.counts.patterns],
      words: { ...this.counts.words },
      blocks: this.counts.blocks,
      chars: this.counts.chars,
      replies: this.counts.replies,
    }
    let textBlocks = this.textBlocks
    let textChars = this.textChars
    if (snapshot.partial !== null) {
      for (const block of snapshot.partial.blocks) {
        if (block.kind === 'reasoning') foldBlock(live, block)
        else if (block.kind === 'text' && block.text !== undefined) {
          textBlocks += 1
          textChars += block.text.length
        }
      }
    }
    return toTrajectoryStats(
      live,
      snapshot.partial !== null,
      { textBlocks, textChars },
      probeGraySession(snapshot),
    )
  }

  /** Whether the accumulator carries any folded data (drives cache reuse). */
  get empty(): boolean {
    return this.counts.replies === 0 && this.counts.blocks === 0
  }

  /** Serialize for durable storage. */
  persist(): VersionedPersistedSessionStats {
    return {
      v: PERSISTENCE_VERSION,
      taxonomyVersion: KEYWORD_TAXONOMY_VERSION,
      classifierVersion: CLASSIFIER_VERSION,
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
      textBlocks: this.textBlocks,
      textChars: this.textChars,
    }
  }

  /** Rehydrate from durable storage; returns a fresh accumulator on mismatch. */
  static load(data: unknown): SessionStatsAccumulator {
    const acc = new SessionStatsAccumulator()
    if (typeof data !== 'object' || data === null) return acc
    const raw = data as {
      v?: unknown
      taxonomyVersion?: unknown
      classifierVersion?: unknown
      minSeq?: unknown
      maxSeq?: unknown
      lastCompactionSeq?: unknown
      counts?: unknown
      textBlocks?: unknown
      textChars?: unknown
    }
    const isLegacy = raw.v === 1
    const isCurrent = raw.v === PERSISTENCE_VERSION
    if (!isLegacy && !isCurrent) return acc
    if (isLegacy) {
      // v1 used the same taxonomy/classifier rules but did not persist their
      // identities. It is safe to migrate only while those original versions
      // remain current; a future rule change must reject v1 and recount.
      if (KEYWORD_TAXONOMY_VERSION !== 1 || CLASSIFIER_VERSION !== 1) return acc
    } else if (raw.taxonomyVersion !== KEYWORD_TAXONOMY_VERSION
      || raw.classifierVersion !== CLASSIFIER_VERSION) {
      return acc
    }
    if (typeof raw.counts !== 'object' || raw.counts === null) return acc
    const counts = raw.counts as Partial<SessionCounts>
    acc.minSeq = typeof raw.minSeq === 'number' ? raw.minSeq : 0
    acc.maxSeq = typeof raw.maxSeq === 'number' ? raw.maxSeq : -1
    acc.lastCompactionSeq = typeof raw.lastCompactionSeq === 'number' ? raw.lastCompactionSeq : 0
    acc.counts.blocks = finiteNumber(counts.blocks)
    acc.counts.chars = finiteNumber(counts.chars)
    acc.counts.replies = finiteNumber(counts.replies)
    acc.textBlocks = finiteNumber(raw.textBlocks)
    acc.textChars = finiteNumber(raw.textChars)
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

  private foldNode(node: ConversationNodeView): void {
    this.counts.replies += 1
    for (const block of node.blocks ?? []) {
      if (block.kind === 'reasoning') foldBlock(this.counts, block)
      else if (block.kind === 'text' && block.text !== undefined) {
        this.textBlocks += 1
        this.textChars += block.text.length
      }
    }
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
    this.textBlocks = 0
    this.textChars = 0
  }
}
