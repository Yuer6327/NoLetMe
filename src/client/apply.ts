/**
 * NoLetMe browser plugin body.
 *
 * Registers a `shell.overlay` entry (the layout's frame-wide floating layer —
 * additive and root-scoped) that hosts the reasoning-trajectory stats panel.
 * The panel receives the current session's live conversation slice through
 * an inject `hooks` compartment built over `ctx.sessions` (and, on 0.1.2+,
 * `ctx.uiConversation` for the nodes that left SessionFace).
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only merges: Context.locale (locale plugin) and the `shell.overlay`
// SlotMap declaration (ui-layout). Both are erased at compile time.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { ConversationPort } from './conversation.ts'
import { NoLetMePanel } from './NoLetMePanel.tsx'
import { createStatsStore } from './session-store.ts'
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

  // The stats store owns live folding, full-history paging, and persistence.
  // uiConversation is looked up lazily: it must not be a cordis inject, or
  // the fiber would hang forever on hosts that never provide it (rc.7–0.1.1).
  const stats = createStatsStore(
    ctx.sessions,
    typeof window === 'undefined' ? undefined : window.localStorage,
    conversationBindingOf(ctx),
  )

  // `slots.inject` defers the registration until ui-layout declares
  // `shell.overlay` (handles boot-order regardless of the graph edge).
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'noletme',
    locale: NS,
    inject: (): NoLetMeFace => ({ hooks: { stats } }),
  }, NoLetMePanel))
}

/**
 * Resolve the 0.1.2+ conversation assembly for one session, if the host
 * provides `ctx.uiConversation`. Missing or throwing is a no-op: rc.7–0.1.1
 * keep `nodes`/`partial` on SessionFace, so the live source still counts.
 */
function conversationBindingOf(ctx: { get: (name: string) => unknown }): (id: string) => ConversationPort | undefined {
  return (id) => {
    const ui = ctx.get('uiConversation') as { binding?: (sessionId: string) => ConversationPort } | undefined
    if (ui === undefined || typeof ui.binding !== 'function') return undefined
    const binding = ui.binding(id)
    if (binding === undefined || typeof binding.snapshot?.getSnapshot !== 'function') return undefined
    return binding
  }
}
