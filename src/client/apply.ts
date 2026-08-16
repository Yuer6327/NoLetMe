/**
 * NoLetMe browser plugin body.
 *
 * Registers a `shell.overlay` entry (the layout's frame-wide floating layer —
 * additive and root-scoped) that hosts the reasoning-trajectory stats panel.
 * The panel receives the current session's live `ConversationSnapshot` through
 * an inject `hooks` compartment built over `ctx.sessions`.
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only merges: Context.locale (locale plugin) and the `shell.overlay`
// SlotMap declaration (ui-layout). Both are erased at compile time.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { NoLetMePanel } from './NoLetMePanel.tsx'
import { createLiveConversation } from './session-source.ts'
import type { NoLetMeFace } from './slots.ts'
import { en, NS, zh, type NoLetMeKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    noletme: NoLetMeKey
  }
}

/** Cordis services required by the browser half. */
export const inject = ['slots', 'sessions', 'locale']

/**
 * Mount the NoLetMe panel.
 * @param ctx - Browser root context.
 */
export function apply(ctx: ClientContext): void {
  // Dictionaries first: the register() locale seat renders through the
  // locale face, so the namespace must exist before the panel mounts.
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'noletme: dictionaries')

  const conversation = createLiveConversation(ctx.sessions)

  // `slots.inject` defers the registration until ui-layout declares
  // `shell.overlay` (handles boot-order regardless of the graph edge).
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'noletme',
    locale: NS,
    inject: (): NoLetMeFace => ({ hooks: { conversation } }),
  }, NoLetMePanel))
}
