/**
 * NoLetMe slot contract: the inject face delivered to the `shell.overlay`
 * entry and the composed component props.
 *
 * `shell.overlay` is the layout's frame-wide floating layer (`ui-layout`
 * declares it as a root-scope list slot — additive, click-through until an
 * entry opts into pointer events), which is the documented seat for a surface
 * of the panel's own. The entry carries no owner props; the panel reads the
 * live conversation through the injected `useConversation` hook.
 */

import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  HostObservable, InjectFace, PropsLocale, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'

/** Business face injected into the NoLetMe panel component. */
export interface NoLetMeFace {
  hooks: {
    /** Current session's live conversation snapshot; undefined while no session is current. */
    conversation: HostObservable<ConversationSnapshot | undefined>
  }
}

/** Full composed props of the NoLetMe panel. */
export type NoLetMePanelProps =
  PropsRuntime<'shell.overlay'>
  & InjectFace<NoLetMeFace>
  & PropsLocale<'noletme'>
