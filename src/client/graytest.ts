/**
 * Gray-test probe over **every reasoning block** in the loaded conversation.
 *
 * The 0813 trajectory classifier (`stats.ts` / `keywords.ts`) stays untouched:
 * it still folds We-need / Let-me / The-user-wants. This module answers a
 * different question: does the loaded reasoning match the community gray-test
 * cluster (2026-06 expert-mode, 2026-07 summary CoT, 2026-08-19/08-20
 * `I'm doing` reruns)?
 *
 * The probe works **per turn** — each finalized assistant node is scored
 * independently, so one gray draw is not diluted by earlier 0813 turns — and
 * reports both the per-turn table and a session aggregate. Timing signals
 * (TTFT) come from host-recorded step/chunk timestamps and are shown as raw
 * numbers; they are network-sensitive, so they only add a weak +1.
 */

import type { AssistantBlockView, ConversationView } from './conversation.ts'
import {
  DIRTY_TOKENS, FINGERPRINT_RE, IM_DOING_RE, LIST_LINE_RE, OPENERS,
} from './gray-signals.ts'

/** Version of the gray-test probe (independent of the 0813 classifier). */
export const GRAYTEST_VERSION = 3 as const

/** How confidently the loaded reasoning matches the gray-test cluster. */
export type GrayVerdict = 'miss' | 'possible' | 'likely'

/** Dominant gray-test family, when any. */
export type GrayProfile = 'none' | 'im-doing' | 'summary' | 'fingerprint'

/** One named signal the probe scored. */
export interface GrayEvidence {
  readonly id: string
  readonly hit: boolean
  readonly detail?: string
}

/** Local style / statistical fingerprint (not a model-identity claim). */
export interface StyleStats {
  /** Reasoning blocks folded into the probe. */
  readonly blocks: number
  /** Total reasoning characters. */
  readonly chars: number
  /** Median reasoning-block length. */
  readonly p50: number
  /** Mean reasoning-block length. */
  readonly avg: number
  /** Fraction of non-empty lines that look like list / heading items (0..1). */
  readonly listRatio: number
  /** Type-token ratio of reasoning tokens (0..1). */
  readonly typeToken: number
  /** Mean alphabetic-token length. */
  readonly avgWordLen: number
}

/** Per-turn timing fingerprint from host-recorded event timestamps. */
export interface TurnTiming {
  /** Turn number (`node.turn`), or −1 when unknown. */
  readonly turn: number
  /** firstTokenTime − stepStartTime in ms; null when either boundary is missing. */
  readonly ttftMs: number | null
  /** completedTime − firstTokenTime in ms; null when no token delta recorded. */
  readonly streamMs: number | null
  /** Reasoning characters produced this turn (for throughput context). */
  chars: number
  /** ttftMs ÷ reasoning chars; null without TTFT. */
  ttftPerChar: number | null
}

/**
 * One assistant turn scored on its own. The session verdict aggregates these,
 * so a single gray draw stays visible inside an old 0813 history.
 */
export interface TurnProbe {
  /** Turn number, or −1 when unknown. */
  readonly turn: number
  /** True for the in-flight partial (its blocks change every frame). */
  readonly live: boolean
  readonly verdict: GrayVerdict
  readonly score: number
  readonly imDoing: number
  /** `I'm doing` occurrences per KB of reasoning (density, not raw count). */
  readonly imDoingPerKb: number
  readonly listRatio: number
  readonly opener: string
  readonly dirtyTokens: readonly string[]
  readonly fingerprints: readonly string[]
  readonly timing: TurnTiming
}

/** Probe result over all loaded reasoning. */
export interface GrayProbe {
  /** Verdict of the best turn (any likely → likely; else any possible). */
  readonly verdict: GrayVerdict
  /** Best turn's score clamped to 0..8 then normalized. */
  readonly confidence: number
  /** Family of the best turn. */
  readonly profile: GrayProfile
  /** Best turn's score. */
  readonly score: number
  /** `I'm doing` hits across all reasoning. */
  readonly imDoing: number
  /** Outline/list density across all reasoning (0..1). */
  readonly summaryScore: number
  /** Several mid-length reasoning blocks across the session (supporting only). */
  readonly chunked: boolean
  /** Distinct dirty-token hits found in any turn. */
  readonly dirtyTokens: readonly string[]
  /** Distinct `fp_…` backend fingerprint strings in any turn. */
  readonly fingerprints: readonly string[]
  /** Slow-TTFT seen in at least one turn against the session's dynamic line. */
  readonly slowTtft: boolean
  readonly style: StyleStats
  /**
   * Session network estimate behind the dynamic TTFT line (median/p90 TTFT,
   * stream chars/s). Shown so the user can judge the link themselves.
   */
  readonly network: NetworkProfile
  /** Per-turn probes, oldest first; the last entry may be the live partial. */
  readonly turns: readonly TurnProbe[]
}

const EMPTY_TIMING: TurnTiming = {
  turn: -1,
  ttftMs: null,
  streamMs: null,
  chars: 0,
  ttftPerChar: null,
}

const EMPTY_STYLE: StyleStats = {
  blocks: 0,
  chars: 0,
  p50: 0,
  avg: 0,
  listRatio: 0,
  typeToken: 0,
  avgWordLen: 0,
}

/** No-timing fallback used until ≥ 2 timed turns establish a session line. */
const EMPTY_NETWORK: NetworkProfile = {
  samples: 0,
  ttftBaseline: null,
  ttftSpread: null,
  streamCharsPerSec: null,
  slowLineMs: null,
}

const EMPTY_PROBE: GrayProbe = {
  verdict: 'miss',
  confidence: 0,
  profile: 'none',
  score: 0,
  imDoing: 0,
  summaryScore: 0,
  chunked: false,
  dirtyTokens: [],
  fingerprints: [],
  slowTtft: false,
  style: EMPTY_STYLE,
  network: EMPTY_NETWORK,
  turns: [],
}

function reasoningTexts(blocks: readonly AssistantBlockView[]): string[] {
  const out: string[] = []
  for (const block of blocks) {
    if (block.kind !== 'reasoning' || block.text === undefined || block.text === '') continue
    out.push(block.text)
  }
  return out
}

function firstLine(text: string): string {
  const line = text.split(/\r?\n/u, 1)[0]?.trim() ?? ''
  return line.length > 80 ? `${line.slice(0, 77)}…` : line
}

function countMatches(text: string, re: RegExp): number {
  const matches = text.match(re)
  return matches === null ? 0 : matches.length
}

function tokenize(text: string): readonly string[] {
  return text
    .toLowerCase()
    .split(/\s+/u)
    .map(token => token.replace(/^[^a-z0-9']+|[^a-z0-9']+$/gu, ''))
    .filter(token => token !== '')
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function unique(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(value)
  }
  return out
}

function clamp01(value: number): number {
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

function styleOf(texts: readonly string[], listRatio: number): StyleStats {
  const lengths = texts.map(text => text.length)
  const chars = lengths.reduce((sum, n) => sum + n, 0)
  const tokens = tokenize(texts.join('\n'))
  const types = new Set(tokens)
  const letterLens = tokens.map(token => token.replace(/'/g, '').length).filter(n => n > 0)
  const wordSum = letterLens.reduce((sum, n) => sum + n, 0)
  return {
    blocks: texts.length,
    chars,
    p50: Math.round(median(lengths)),
    avg: texts.length === 0 ? 0 : Math.round(chars / texts.length),
    listRatio,
    typeToken: tokens.length === 0 ? 0 : types.size / tokens.length,
    avgWordLen: letterLens.length === 0 ? 0 : wordSum / letterLens.length,
  }
}

/** List-line density over non-empty lines of the given texts. */
function listDensity(texts: readonly string[]): number {
  let lines = 0
  let list = 0
  for (const text of texts) {
    for (const raw of text.split(/\n+/u)) {
      const line = raw.trim()
      if (line === '') continue
      lines += 1
      if (LIST_LINE_RE.test(line)) list += 1
    }
  }
  return lines === 0 ? 0 : list / lines
}

/**
 * Community "首字很慢" tell. Deliberately loose (≥ 6 s absolute or ≥ 300 ms
 * per reasoning char) because host timestamps include queueing + network.
 */
export function isSlowTtft(timing: TurnTiming): boolean {
  return timing.ttftMs !== null
    && (timing.ttftMs >= 6000 || (timing.ttftPerChar !== null && timing.ttftPerChar >= 300))
}

/**
 * Network-quality estimate for one session, from the turn timings themselves.
 *
 * A raw TTFT mixes queueing + network + model latency, so a fixed threshold
 * misfires on slow links. Instead the session's own turns provide the
 * baseline:
 *
 *  - `ttftBaseline` — median TTFT across timed turns (the link's floor);
 *  - `ttftSpread` — p90/p50 ratio (how bursty latencies are);
 *  - `streamCharsPerSec` — completedTime−firstTokenTime over reasoning chars
 *    (delivery speed; a slow *link* throttles this too).
 *
 * `slowLineMs` is then a dynamic line: max(baseline + 3 s, baseline × 2),
 * floored at 2.5 s and capped at 60 s. A uniformly slow link raises its own
 * baseline instead of flagging every turn; a fast link keeps a tight line and
 * still catches multi-second stalls.
 */
export interface NetworkProfile {
  /** Timed turns used for the estimate (0 → no data). */
  readonly samples: number
  /** Median TTFT in ms; null without samples. */
  readonly ttftBaseline: number | null
  /** p90 TTFT ÷ p50 TTFT; 1 when all equal; null without samples. */
  readonly ttftSpread: number | null
  /** Reasoning chars per second during streaming (median of timed turns). */
  readonly streamCharsPerSec: number | null
  /** Dynamic slow-TTFT line for this session, ms; null without samples. */
  readonly slowLineMs: number | null
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))
  return sorted[index]
}

/** Derive the session's network profile and its dynamic slow-TTFT line. */
export function networkProfileOf(timings: readonly TurnTiming[]): NetworkProfile {
  const timed = timings.filter((t): t is TurnTiming & { ttftMs: number } =>
    t.ttftMs !== null && t.ttftMs >= 0)
  if (timed.length === 0) return EMPTY_NETWORK

  const ttfts = timed.map(t => t.ttftMs as number)
  const p50 = percentile(ttfts, 0.5)
  const p90 = percentile(ttfts, 0.9)

  const streams = timed
    .map(t => {
      const streamMs = t.streamMs
      const chars = t.chars
      return streamMs !== null && streamMs > 250 ? chars / (streamMs / 1000) : null
    })
    .filter((value): value is number => value !== null)
  const streamCharsPerSec = streams.length === 0 ? null : percentile(streams, 0.5)

  // Spread widens the line on jittery links; a stable fast link keeps it tight.
  const spread = p50 > 0 ? p90 / p50 : 1
  const slowLineMs = Math.round(Math.min(60_000, Math.max(2_500, Math.max(p50 + 3_000, p50 * 2 * spread))))

  return {
    samples: timed.length,
    ttftBaseline: Math.round(p50),
    ttftSpread: Math.round(spread * 100) / 100,
    streamCharsPerSec: streamCharsPerSec === null ? null : Math.round(streamCharsPerSec),
    slowLineMs,
  }
}

/**
 * Slow-TTFT verdict against a session-derived line. Falls back to the static
 * rule when no baseline exists yet.
 */
export function isSlowTtftAgainst(timing: TurnTiming, profile: NetworkProfile): boolean {
  if (timing.ttftMs === null) return false
  if (profile.slowLineMs === null || profile.samples < 2) return isSlowTtft(timing)
  return timing.ttftMs >= profile.slowLineMs
}

/**
 * Score one bag of reasoning blocks with optional timing. Pure — used by the
 * per-turn fold and by tests.
 */
export function scoreTurn(
  texts: readonly string[],
  options: { live?: boolean; turn?: number; timing?: TurnTiming; slowTtft?: boolean } = {},
): TurnProbe {
  const turnNo = options.turn ?? -1
  const emptyTiming: TurnTiming = { ...EMPTY_TIMING, turn: turnNo }
  if (texts.length === 0) {
    return {
      turn: turnNo,
      live: options.live ?? false,
      verdict: 'miss',
      score: 0,
      imDoing: 0,
      imDoingPerKb: 0,
      listRatio: 0,
      opener: '',
      dirtyTokens: [],
      fingerprints: [],
      timing: options.timing ?? emptyTiming,
    }
  }

  const joined = texts.join('\n')
  const chars = joined.length
  const opener = firstLine(texts[texts.length - 1])
  const imDoing = countMatches(joined, IM_DOING_RE)
  const lm = joined.match(/\blet\s+me\b/gi)
  const letMe = lm === null ? 0 : lm.length
  const wem = joined.match(/\bwe\b/gi)
  const we = wem === null ? 0 : wem.length
  const listRatio = listDensity(texts)

  const dirtyTokens: string[] = []
  for (const token of DIRTY_TOKENS) {
    if (token.pattern.test(joined)) dirtyTokens.push(token.id)
  }
  const fingerprints = unique(joined.match(FINGERPRINT_RE) ?? [])

  // Summary-shape: outline bullets are the tell; short paragraphs only count
  // alongside I'm doing (0813 We-need blocks are short too).
  const summaryHit = listRatio >= 0.35 || (imDoing > 0 && listRatio >= 0.15)

  let score = 0
  if (imDoing > 0) score += 4
  if (OPENERS.some(entry => entry.re.test(opener))) score += OPENERS[0].weight
  if (imDoing > 0 && letMe === 0) score += 1
  if (summaryHit) score += 2
  if (dirtyTokens.length > 0) score += 2
  if (fingerprints.length > 0) score += 2
  const slowTtft = options.slowTtft ?? isSlowTtft(options.timing ?? EMPTY_TIMING)
  if (slowTtft) score += 1
  // 0813-standard / minimal trajectories argue against the 08-19 gray.
  if (letMe >= 2 && imDoing === 0) score -= 3
  if (we >= 3 && imDoing === 0 && !summaryHit) score -= 1

  const verdict: GrayVerdict = score >= 5 ? 'likely' : score >= 2 ? 'possible' : 'miss'
  const kb = Math.max(chars, 1) / 1024

  return {
    turn: turnNo,
    live: options.live ?? false,
    verdict,
    score,
    imDoing,
    imDoingPerKb: imDoing / kb,
    listRatio,
    opener,
    dirtyTokens,
    fingerprints,
    timing: options.timing ?? emptyTiming,
  }
}

/** @internal cached fold entry keyed by node identity. */
interface CachedTurn {
  texts: readonly string[]
  probe: TurnProbe
  /** The dynamic-line verdict the cached probe was scored with. */
  slowTtft: boolean
}

/**
 * Per-session turn cache. A module-level WeakMap would be fine for finalized
 * nodes (they are GC'd with the session), but the accumulator passes a stable
 * per-session cache so switching sessions cannot reuse another session's
 * entries when a host reuses node objects across snapshots.
 */
const caches: WeakMap<object, WeakMap<object, CachedTurn>> = new WeakMap()

/** Get (or lazily create) the turn cache owned by `owner` (the accumulator). */
export function grayTurnCacheFor(owner: object): WeakMap<object, CachedTurn> {
  let cache = caches.get(owner)
  if (cache === undefined) {
    cache = new WeakMap()
    caches.set(owner, cache)
  }
  return cache
}

/**
 * Read host-recorded timing off an assistant node. Tolerates older hosts that
 * omit `timing` entirely.
 */
function timingOf(node: object): { base: Omit<TurnTiming, 'chars' | 'ttftPerChar'> } {
  const t = (node as { timing?: unknown }).timing
  const stepStart = typeof t === 'object' && t !== null
    && typeof (t as { stepStartTime?: unknown }).stepStartTime === 'number'
    ? (t as { stepStartTime: number }).stepStartTime
    : null
  const firstToken = typeof t === 'object' && t !== null
    && typeof (t as { firstTokenTime?: unknown }).firstTokenTime === 'number'
    ? (t as { firstTokenTime: number }).firstTokenTime
    : null
  const completed = typeof t === 'object' && t !== null
    && typeof (t as { completedTime?: unknown }).completedTime === 'number'
    ? (t as { completedTime: number }).completedTime
    : null
  const turnNo = typeof (node as { turn?: unknown }).turn === 'number'
    ? (node as { turn: number }).turn
    : -1
  return {
    base: {
      turn: turnNo,
      ttftMs: stepStart !== null && firstToken !== null ? firstToken - stepStart : null,
      streamMs: firstToken !== null && completed !== null ? completed - firstToken : null,
    },
  }
}

/**
 * Probe every loaded reasoning block of a conversation snapshot, scoring each
 * assistant node independently and aggregating. Per-turn results are cached by
 * node identity, so a streaming delta re-scores only the in-flight partial.
 *
 * TTFT uses a **session-derived dynamic line** (`networkProfileOf`): the
 * median/p90 of this session's own turn timings estimate the link, so a slow
 * proxy does not flag every turn. The line needs ≥ 2 timed turns; below that
 * the static fallback applies. Because the profile shifts as turns land,
 * cached probes whose slow-TTFT flag disagrees with the current line are
 * re-scored (text-only memoization stays valid).
 *
 * Pass `cache` to scope the per-turn memoization to one session's accumulator;
 * without it a module-level cache is used.
 * @param snapshot - live conversation view.
 * @param cache - optional per-session cache (from {@link grayTurnCacheFor}).
 */
export function probeGraySession(
  snapshot: ConversationView,
  cache: WeakMap<object, CachedTurn> = grayTurnCacheFor(probeGraySession),
): GrayProbe {
  const allTexts: string[] = []
  const entries: { key: object; texts: readonly string[]; timing: TurnTiming; live: boolean }[] = []
  const timings: TurnTiming[] = []

  const collect = (
    key: object,
    blocks: readonly AssistantBlockView[],
    base: Omit<TurnTiming, 'chars' | 'ttftPerChar'> | null,
    live: boolean,
  ): void => {
    const texts = reasoningTexts(blocks)
    if (texts.length === 0) return
    allTexts.push(...texts)
    const chars = texts.reduce((sum, text) => sum + text.length, 0)
    const timing: TurnTiming = base === null
      ? { ...EMPTY_TIMING }
      : {
          ...base,
          chars,
          ttftPerChar: base.ttftMs !== null ? base.ttftMs / Math.max(chars, 1) : null,
        }
    timings.push(timing)
    entries.push({ key, texts, timing, live })
  }

  for (const node of snapshot.nodes) {
    if (node.kind !== 'assistant') continue
    collect(node, node.blocks ?? [], timingOf(node).base, false)
  }
  if (snapshot.partial !== null) {
    // The partial carries no timing; its TTFT columns stay blank.
    collect(snapshot.partial, snapshot.partial.blocks, null, true)
  }

  if (entries.length === 0) return EMPTY_PROBE

  // Session network profile → dynamic per-turn slow-TTFT flag.
  const network = networkProfileOf(timings)

  const probes: TurnProbe[] = entries.map(({ key, texts, timing, live }) => {
    const slowTtft = live ? false : isSlowTtftAgainst(timing, network)
    const cached = cache.get(key)
    // Text-only memoization; rescore when the dynamic TTFT verdict moved.
    if (cached !== undefined && cached.texts === texts && cached.slowTtft === slowTtft) {
      return cached.probe
    }
    const probe = scoreTurn(texts, {
      turn: timing.turn,
      live,
      timing,
      slowTtft,
    })
    cache.set(key, { texts, probe, slowTtft })
    return probe
  })

  const style = styleOf(allTexts, listDensity(allTexts))

  // Aggregate: any likely turn → likely; else any possible → possible.
  let verdict: GrayVerdict = 'miss'
  for (const probe of probes) {
    if (probe.verdict === 'likely') { verdict = 'likely'; break }
    if (probe.verdict === 'possible') verdict = 'possible'
  }
  const best = probes.reduce((a, b) => (b.score > a.score ? b : a), probes[0])
  const imDoing = probes.reduce((sum, p) => sum + p.imDoing, 0)
  const dirtyTokens = unique(probes.flatMap(p => [...p.dirtyTokens]))
  const fingerprints = unique(probes.flatMap(p => [...p.fingerprints]))
  const lengths = allTexts.map(text => text.length)
  const mid = median(lengths)
  const chunked = probes.length >= 3 && mid >= 30 && mid <= 800

  return {
    verdict,
    confidence: clamp01(Math.max(0, best.score) / 8),
    profile: best.imDoing > 0
      ? 'im-doing'
      : dirtyTokens.length > 0 || fingerprints.length > 0
        ? 'fingerprint'
        : best.listRatio >= 0.35
          ? 'summary'
          : 'none',
    score: best.score,
    imDoing,
    summaryScore: style.listRatio,
    chunked,
    dirtyTokens,
    fingerprints,
    slowTtft: probes.some(p => p.timing.ttftMs !== null && isSlowTtftAgainst(p.timing, network)),
    style,
    network,
    turns: probes,
  }
}

/** Empty probe (no reasoning loaded). */
export function emptyGrayProbe(): GrayProbe {
  return EMPTY_PROBE
}
