/**
 * NoLetMe — Node (host) half.
 *
 * The entire NoLetMe surface is a browser feature (a `shell.overlay` panel).
 * This half exists to give the dsh Loader a working entry for the package so
 * the client-modules scanner can resolve it and serve the browser bundle at
 * `/plugins/dsh-noletme/client.js`. It intentionally registers nothing on the
 * host; any host-side state (settings, persistence) would land here later.
 */

import type { Context } from '@deepseek-ai/cordis'

/** Cordis plugin name. */
export const name = 'dsh-noletme'

/**
 * Activate the host fiber. No-op by design: the web panel is entirely client
 * side, and the loader only requires that this module load cleanly.
 * @param _ctx - Host context (unused).
 */
export function apply(_ctx: Context): void {
  /* The client half (src/client) registers the shell.overlay panel. */
}
