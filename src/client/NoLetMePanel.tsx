/**
 * NoLetMe reasoning-trajectory panel.
 *
 * A `shell.overlay` entry (root scope) docked to the top-right of the frame.
 * Reads the current session's live `ConversationSnapshot` through the injected
 * `useConversation` hook and folds its reasoning blocks into keyword stats in
 * real time (the session layer republishes the snapshot at most once per
 * animation frame as `reasoning-delta` chunks stream).
 *
 * Styling mirrors the shipped `DetailsPanel` (theme tokens only, CSS Modules,
 * keyboard-focus + reduced-motion preserved) so the panel reads as native dsh
 * chrome rather than an add-on.
 */

import { useMemo, useState } from 'react'
import { computeStats, formatCount } from './stats.ts'
import { GROUPS, PATTERNS, type Group, type Mode } from './keywords.ts'
import type { NoLetMePanelProps } from './slots.ts'
import css from './NoLetMePanel.module.css'

/** Theme alias for one trajectory category (dsh state tokens). */
const GROUP_COLOR: Readonly<Record<Group, string>> = {
  efficient: 'var(--dsw-alias-state-success-primary)',
  hesitant: 'var(--dsw-alias-state-warn-primary)',
  neutral: 'var(--dsw-alias-label-secondary)',
}

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

/** The panel: a floating card (expanded) or a mode pill (collapsed). */
export function NoLetMePanel({ useConversation, t }: NoLetMePanelProps) {
  const snapshot = useConversation(state => state)
  const stats = useMemo(() => computeStats(snapshot), [snapshot])
  const [open, setOpen] = useState(readOpenPreference)

  const toggle = (): void => {
    setOpen(prev => {
      const next = !prev
      writeOpenPreference(next)
      return next
    })
  }

  const mode = stats?.mode

  return (
    <div
      className={css.root}
      data-open={open || undefined}
      data-mode={mode}
      data-streaming={stats?.streaming || undefined}
      role="region"
      aria-label={t('panel.aria')}
    >
      {!open ? (
        <button
          type="button"
          className={css.pill}
          onClick={toggle}
          aria-expanded="false"
          title={t('panel.title')}
        >
          <span className={css.pillDot} data-mode={mode} aria-hidden="true" />
          <span>NoLetMe</span>
          {mode !== undefined && <span className={css.pillMode}>{t(`mode.${mode}`)}</span>}
        </button>
      ) : (
        <PanelCard open={open} onToggle={toggle} t={t} stats={stats} />
      )}
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

/** Footer: hesitation-pressure health note and the research basis hint. */
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
      <p className={css.hint}>{t('panel.researchHint')}</p>
    </footer>
  )
}

export type { Mode }
