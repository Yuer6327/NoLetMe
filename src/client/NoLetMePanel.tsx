/**
 * NoLetMe reasoning-trajectory panel.
 *
 * A `shell.overlay` entry (root scope) docked to the top-right of the frame.
 * Reads the current session's live `ConversationSnapshot` through the injected
 * `useConversation` hook and folds its reasoning blocks into keyword stats in
 * real time (the session layer republishes the snapshot at most once per
 * animation frame as `reasoning-delta` chunks stream).
 *
 * One surface, two shapes: the same element is a compact mode pill when
 * collapsed and a rounded card when expanded, and the two shapes morph into
 * each other on a critically-damped spring (interruptible — a re-click
 * retargets from the on-screen values, never the targets). The pill↔card morph
 * follows Apple's fluid-interface principles: springs over keyframes,
 * anchoring the growth at the right edge (fixed `right`, so the panel grows
 * leftward from its dock), and a cross-fade instead of the spring under
 * `prefers-reduced-motion`.
 *
 * Styling mirrors the shipped `DetailsPanel` (theme tokens only, CSS Modules,
 * hover-reveal scrollbar via the `--dsh-scrollbar-*` rebind the harness uses
 * for elevated surfaces, keyboard-focus + reduced-motion preserved) so the
 * panel reads as native dsh chrome rather than an add-on.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { computeStats, formatCount } from './stats.ts'
import { GROUPS, PATTERNS, type Group, type Mode } from './keywords.ts'
import type { NoLetMePanelProps } from './slots.ts'
import css from './NoLetMePanel.module.css'

/** Card width when expanded. */
const CARD_W = 300
/** Collapsed pill height. */
const PILL_H = 34
/** Card content cap: 560px or the viewport minus dock margins. */
const MAX_H = () => Math.min(560, Math.max(240, (typeof window === 'undefined' ? 900 : window.innerHeight) - 32))

/** Apple-style spring: critically damped (damping ratio 1.0), ~0.4s response. */
const SPRING_RESPONSE = 0.4
const SPRING_OMEGA = (2 * Math.PI) / SPRING_RESPONSE
const SPRING_K = SPRING_OMEGA * SPRING_OMEGA
const SPRING_C = 2 * Math.sqrt(SPRING_K) // zeta = 1.0

/** Theme alias for one trajectory category (dsh state tokens). */
const GROUP_COLOR: Readonly<Record<Group, string>> = {
  efficient: 'var(--dsw-alias-state-success-primary)',
  hesitant: 'var(--dsw-alias-state-warn-primary)',
  neutral: 'var(--dsw-alias-label-secondary)',
}

/** Animated morph state. `o` = card-layer opacity (pill = 1 − o). */
interface Morph {
  w: number
  h: number
  r: number
  o: number
}

const PILL_MORPH: Morph = { w: 0, h: PILL_H, r: 999, o: 0 }

/** Read the persisted open/collapsed preference (best-effort). */
function readOpenPreference(): boolean {
  try {
    return window.localStorage.getItem('dsh-noletme.open') !== '0'
  } catch {
    return true
  }
}

/** Persist the panel's open state (best-effort). */
function writeOpenPreference(open: boolean): void {
  try {
    window.localStorage.setItem('dsh-noletme.open', open ? '1' : '0')
  } catch {
    /* storage unavailable (private mode etc.): non-fatal */
  }
}

/** The panel: one element that morphs between pill (collapsed) and card (expanded). */
export function NoLetMePanel({ useConversation, t }: NoLetMePanelProps) {
  const snapshot = useConversation(state => state)
  const stats = useMemo(() => computeStats(snapshot), [snapshot])
  const [open, setOpen] = useState(readOpenPreference)

  const cardRef = useRef<HTMLDivElement>(null)
  const pillRef = useRef<HTMLButtonElement>(null)
  const [cardH, setCardH] = useState(0)
  const [pillW, setPillW] = useState(0)

  // Live morph values + per-axis velocity (presentation state for the spring).
  const [morph, setMorph] = useState<Morph>(PILL_MORPH)
  const live = useRef({ ...PILL_MORPH, vw: 0, vh: 0, vr: 0, vo: 0, running: false })
  const first = useRef(true)

  const toggle = (): void => {
    setOpen(prev => {
      const next = !prev
      writeOpenPreference(next)
      return next
    })
  }

  // Measure the card's natural (uncapped) height and the pill's natural width.
  useEffect(() => {
    const card = cardRef.current
    const pill = pillRef.current
    if (card === null || pill === null) return
    const cardObs = new ResizeObserver(() => setCardH(card.offsetHeight))
    const pillObs = new ResizeObserver(() => setPillW(pill.offsetWidth))
    cardObs.observe(card)
    pillObs.observe(pill)
    return () => {
      cardObs.disconnect()
      pillObs.disconnect()
    }
  }, [])

  // Morph spring: retarget whenever open state, content height, or pill width
  // moves. Starts from the live presentation values (interruptible).
  useEffect(() => {
    const target: Morph = open
      ? { w: CARD_W, h: Math.min(cardH || CARD_W, MAX_H()), r: 12, o: 1 }
      : { w: pillW || 110, h: PILL_H, r: 999, o: 0 }

    if (first.current) {
      first.current = false
      const s = live.current
      s.w = target.w; s.h = target.h; s.r = target.r; s.o = target.o
      s.vw = s.vh = s.vr = s.vo = 0
      setMorph(target)
      return
    }

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const s = live.current
      s.w = target.w; s.h = target.h; s.r = target.r; s.o = target.o
      s.vw = s.vh = s.vr = s.vo = 0
      setMorph(target)
      return
    }

    const s = live.current
    s.running = true
    let raf = 0
    let last = performance.now()

    const frame = (now: number): void => {
      if (!s.running) return
      const dt = Math.min((now - last) / 1000, 1 / 30)
      last = now

      // Semi-implicit Euler integration per axis (independent springs).
      const ax = -SPRING_K * (s.w - target.w) - SPRING_C * s.vw
      s.vw += ax * dt
      s.w += s.vw * dt
      const ah = -SPRING_K * (s.h - target.h) - SPRING_C * s.vh
      s.vh += ah * dt
      s.h += s.vh * dt
      const ar = -SPRING_K * (s.r - target.r) - SPRING_C * s.vr
      s.vr += ar * dt
      s.r += s.vr * dt
      const ao = -SPRING_K * (s.o - target.o) - SPRING_C * s.vo
      s.vo += ao * dt
      s.o += s.vo * dt

      const settled = Math.abs(s.w - target.w) < 0.5
        && Math.abs(s.h - target.h) < 0.5
        && Math.abs(s.r - target.r) < 0.5
        && Math.abs(s.o - target.o) < 0.005
        && Math.abs(s.vw) < 0.5
        && Math.abs(s.vh) < 0.5
        && Math.abs(s.vr) < 0.5
        && Math.abs(s.vo) < 0.005

      if (settled) {
        s.w = target.w; s.h = target.h; s.r = target.r; s.o = target.o
        s.vw = s.vh = s.vr = s.vo = 0
        setMorph(target)
        return
      }
      setMorph({ w: s.w, h: s.h, r: s.r, o: s.o })
      raf = requestAnimationFrame(frame)
    }

    raf = requestAnimationFrame(frame)
    return () => {
      s.running = false
      cancelAnimationFrame(raf)
    }
  }, [open, cardH, pillW])

  const cardVisible = morph.o > 0
  const pillVisible = morph.o < 1
  const mode = stats?.mode

  return (
    <div
      className={css.root}
      data-mode={mode}
      data-streaming={stats?.streaming || undefined}
      role="region"
      aria-label={t('panel.aria')}
      style={{ width: morph.w, height: morph.h, borderRadius: morph.r }}
    >
      {/* Collapsed pill layer (opacity fades out as the card grows in). */}
      <button
        ref={pillRef}
        type="button"
        className={css.pill}
        onClick={toggle}
        aria-expanded={open}
        title={t('panel.title')}
        style={{
          opacity: 1 - morph.o,
          visibility: pillVisible ? 'visible' : 'hidden',
          pointerEvents: morph.o < 0.5 ? 'auto' : 'none',
        }}
      >
        <span className={css.pillDot} data-mode={mode} aria-hidden="true" />
        <span>NoLetMe</span>
        {mode !== undefined && <span className={css.pillMode}>{t(`mode.${mode}`)}</span>}
      </button>

      {/* Expanded card layer (clipped by the morphing root while it grows). */}
      <div
        ref={cardRef}
        className={css.card}
        style={{
          opacity: morph.o,
          visibility: cardVisible ? 'visible' : 'hidden',
          pointerEvents: morph.o > 0.5 ? 'auto' : 'none',
        }}
      >
        <PanelCard open={open} onToggle={toggle} t={t} stats={stats} />
      </div>
    </div>
  )
}

/** Expanded card body. */
function PanelCard({
  open,
  onToggle,
  t,
  stats,
}: {
  open: boolean
  onToggle: () => void
  t: NoLetMePanelProps['t']
  stats: ReturnType<typeof computeStats>
}) {
  return (
    <>
      <header className={css.header}>
        <h2 className={css.title}>{t('panel.title')}</h2>
        <button
          type="button"
          className={css.toggle}
          onClick={onToggle}
          aria-expanded={open}
          aria-label={t('panel.collapse')}
          title={t('panel.collapse')}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2 3h8M2 6h5M2 9h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none" />
          </svg>
        </button>
      </header>
      <div className={css.body}>
        {stats === null ? (
          <p className={css.empty}>{t('panel.noSession')}</p>
        ) : (
          <>
            <StatusRow stats={stats} t={t} />
            <ModeSection stats={stats} t={t} />
            <PatternSection stats={stats} t={t} />
            <Footer stats={stats} t={t} />
          </>
        )}
      </div>
    </>
  )
}

/** Live status strip: streaming dot, reasoning block / char counts, replies. */
function StatusRow({ stats, t }: { stats: NonNullable<ReturnType<typeof computeStats>>; t: NoLetMePanelProps['t'] }) {
  return (
    <div className={css.status}>
      <span className={css.statusItem}>
        <span className={css.liveDot} aria-hidden="true" />
        {stats.streaming ? t('panel.streaming') : t('panel.idle')}
      </span>
      <span className={css.statusItem}>
        {t('panel.reasoningBlocks')}
        <b className={css.value}>{stats.blocks}</b>
      </span>
      <span className={css.statusItem}>
        {t('panel.reasoningChars')}
        <b className={css.value}>{formatCount(stats.chars)}</b>
      </span>
      <span className={css.statusItem}>
        {t('panel.replies')}
        <b className={css.value}>{stats.replies}</b>
      </span>
    </div>
  )
}

/** Trajectory-mode badge plus per-category share bars. */
function ModeSection({ stats, t }: { stats: NonNullable<ReturnType<typeof computeStats>>; t: NoLetMePanelProps['t'] }) {
  return (
    <section className={css.section}>
      <h3 className={css.sectionLabel}>{t('panel.modeLabel')}</h3>
      <span className={css.modeBadge} data-mode={stats.mode}>
        {t(`mode.${stats.mode}`)}
      </span>
      {GROUPS.map(group => (
        <div className={css.barRow} key={group}>
          <span className={css.barLabel}>{t(`group.${group}`)}</span>
          <span className={css.barTrack}>
            <span
              className={css.barFill}
              style={{ width: `${Math.round(stats.shares[group] * 100)}%`, background: GROUP_COLOR[group] }}
            />
          </span>
          <span className={css.barValue}>{stats.groups[group]}</span>
        </div>
      ))}
    </section>
  )
}

/** Keyword breakdown: nonzero patterns grouped by category, plus raw word metrics. */
function PatternSection({ stats, t }: { stats: NonNullable<ReturnType<typeof computeStats>>; t: NoLetMePanelProps['t'] }) {
  const rows = stats.patterns
    .map((count, index) => ({ pattern: PATTERNS[index], count, index }))
    .filter(row => row.count > 0)
    .sort((a, b) => {
      const ga = GROUPS.indexOf(a.pattern.group)
      const gb = GROUPS.indexOf(b.pattern.group)
      return ga !== gb ? ga - gb : b.count - a.count
    })

  return (
    <section className={css.section}>
      <h3 className={css.sectionLabel}>{t('panel.patternsLabel')}</h3>
      <div className={css.metrics}>
        <span className={css.metric}>
          we <b className={css.metricValue}>{stats.words.we}</b>
        </span>
        <span className={css.metric}>
          let&rsquo;s <b className={css.metricValue}>{stats.words.lets}</b>
        </span>
        <span className={css.metric}>
          let me <b className={css.metricValue}>{stats.words.letMe}</b>
        </span>
        <span className={css.metric}>
          I <b className={css.metricValue}>{stats.words.firstPerson}</b>
        </span>
      </div>
      {rows.length === 0 ? (
        <p className={css.empty}>{t('panel.noKeywords')}</p>
      ) : (
        <div className={css.patternList}>
          {rows.map(row => (
            <span
              key={row.index}
              className={css.patternItem}
              title={row.pattern.note}
            >
              <span
                className={css.patternDot}
                style={{ background: GROUP_COLOR[row.pattern.group] }}
                aria-hidden="true"
              />
              <span className={css.patternKey}>{t(row.pattern.label)}</span>
              <span className={css.patternCount}>{row.count}</span>
            </span>
          ))}
        </div>
      )}
    </section>
  )
}

/** Footer: hesitation-pressure health note. */
function Footer({ stats, t }: { stats: NonNullable<ReturnType<typeof computeStats>>; t: NoLetMePanelProps['t'] }) {
  const health: 'low' | 'mid' | 'high' = stats.hesitation === 0
    ? 'low'
    : stats.hesitation < 0.5 && stats.words.letMe <= 5
      ? 'mid'
      : 'high'
  return (
    <footer className={css.footer}>
      <div className={css.healthRow}>
        {t('panel.healthLabel')}
        <b className={css.healthValue} data-health={health}>{t(`panel.health.${health}`)}</b>
      </div>
    </footer>
  )
}

export type { Mode }
