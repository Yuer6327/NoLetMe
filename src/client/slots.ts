/**
 * NoLetMe slot contract: the inject face delivered to the `shell.overlay`
 * entry and the composed component props.
 *
 * `shell.overlay` is the layout's frame-wide floating layer (`ui-layout`
 * declares it as a root-scope list slot — additive, click-through until an
 * entry opts into pointer events), which is the documented seat for a surface
 * of the panel's own. The entry carries no owner props; the panel reads the
 * live trajectory stats through the injected `useStats` hook.
 */

import type {
  HostObservable, InjectFace, PropsLocale, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { StatsSnapshot } from './session-store.ts'

/** Business face injected into the NoLetMe panel component. */
export interface NoLetMeFace {
  hooks: {
    /** Live per-session trajectory stats (persisted, full-history). */
    stats: HostObservable<StatsSnapshot>
  }
}

/** Full composed props of the NoLetMe panel. */
export type NoLetMePanelProps =
  PropsRuntime<'shell.overlay'>
  & InjectFace<NoLetMeFace>
  & PropsLocale<'noletme'>
