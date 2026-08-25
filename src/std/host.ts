/**
 * dsh-std Community v0.15 host facet (`dsh-plugin.json` → `facets.host.entry`).
 *
 * Loaded by `@dsh-std/adapter-dsh` (or any host that follows the FacetModule
 * lifecycle). The NoLetMe surface is a web `shell.overlay` panel; Community
 * v0.15 / `browser.ui.dsh/v1alpha1` only ships `SettingsSection` and
 * `ToolCallView`, so the panel stays on the native `dsh.client` entry. This
 * facet exists so a standard host can discover, activate, and inventory the
 * package without executing product-specific client code.
 *
 * Protocol coordinates are inlined structurally — dsh-std does not require
 * depending on the reference npm packages.
 */

/** lifecycle.dsh/v1alpha1 ActivationContext subset used by this facet. */
export interface StdActivationContext {
  readonly scope: {
    readonly signal: AbortSignal
    add(dispose: () => void | Promise<void>): () => void
  }
}

export interface StdFacetProjection {
  readonly state?: 'active' | 'degraded'
  readonly message?: string
}

export interface StdFacetModule {
  activate(context: StdActivationContext): void | Promise<void>
  deactivate?(reason: string): void | Promise<void>
  snapshot?(): StdFacetProjection | Promise<StdFacetProjection>
}

const SNAPSHOT: StdFacetProjection = Object.freeze({
  state: 'active',
  message: 'NoLetMe panel remains on the native dsh.client web entry; Community v0.15 has no overlay surface',
})

function activate(_context: StdActivationContext): void {
  /* No host-side publications: overlay registration is a product web slot. */
}

function deactivate(_reason: string): void {
  /* Nothing to retract. */
}

function snapshot(): StdFacetProjection {
  return SNAPSHOT
}

const facet: StdFacetModule = Object.freeze({
  activate,
  deactivate,
  snapshot,
})

export { facet as stdFacet }
export default facet
