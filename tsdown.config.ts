/**
 * Standalone tsdown build for the NoLetMe plugin.
 *
 * Emits two artifacts into `lib/`:
 *
 *  1. `lib/index.js` — the Node (host) half. The dsh Loader imports the
 *     package `main`; this half must exist and load cleanly for the
 *     client-modules scanner to see the package and serve its browser half.
 *
 *  2. `lib/client.js` — the browser half, shaped exactly like the harness's
 *     own `clientBundle` preset: a closure-factory artifact that calls
 *     `window.__ModuleLoader__.load({ id, factory })`, resolves platform
 *     modules through the loader's frozen module table, and inlines CSS
 *     Modules (compiled by lightningcss, injected as a `<style data-plugin>`).
 *
 * The externals list is the rc.7 ∩ rc.8 platform seed (`platform-modules.json`).
 * Every other `@deepseek-ai/*` value import is a build error (the purity gate):
 * the module table cannot answer a specifier it does not know.
 */
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, resolve as resolvePath, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'tsdown'
import { transform } from 'lightningcss'
import platformModules from './src/client/platform-modules.json' with { type: 'json' }

/** Stable plugin id: must equal the package name (the loader keys graph rows and bundles by it). */
const PACKAGE_ID = 'dsh-noletme'

/**
 * Platform modules the shell shares into the frozen module table.
 *
 * This is the intersection of the rc.7 table and the rc.8 table (rc.8 dropped
 * `dsh-client-web-react`, `dsh-client-ui-attachment`, and `dsh-client-schema-form`
 * from the seed). Listing a specifier the host does not seed is a runtime
 * `require` miss, so the bundle only externalizes words both hosts answer.
 * Later 0.1.x hosts that keep adding seed words remain compatible; shrinking
 * this set further is a breaking host change that CI's contract probe will catch.
 *
 * Runtime is a graph-row plugin, not a seed word. Counting reads the snapshot
 * structurally, so the client bundle must not `require` `@deepseek-ai/dsh-client-runtime/client`.
 */
const PLATFORM_MODULES: readonly string[] = platformModules

/** Specifiers resolved from the loader module table at bundle load time. */
const CLIENT_EXTERNALS: string[] = [...PLATFORM_MODULES]

const REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url))

/** Virtual-id wrapper keeping module CSS away from tsdown's own CSS pipeline. */
const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

/** Resolve an emitted JS asset import against its source-tree counterpart. */
function sourceAssetPath(source: string, importer: string): string {
  const emitted = resolvePath(dirname(importer), source)
  if (existsSync(emitted)) return emitted
  const marker = `${sep}lib${sep}types${sep}`
  const boundary = emitted.indexOf(marker)
  if (boundary < 0) return emitted
  return resolvePath(emitted.slice(0, boundary), 'src', emitted.slice(boundary + marker.length))
}

/** Rebase a physical lib-relative source onto a browser URL mirroring the package directories. */
function browserSourcePath(source: string, sourcemapPath: string): string {
  if (!source.startsWith('.')) return source
  const physicalSource = resolvePath(dirname(sourcemapPath), source)
  const repoPath = physicalSource.startsWith(REPOSITORY_ROOT)
    ? physicalSource.slice(REPOSITORY_ROOT.length).replaceAll(sep, '/')
    : source
  return repoPath.startsWith('src/') ? repoPath : source
}

export default defineConfig(() => [
  {
    // Node (host) half: the package `main`. Registers nothing meaningful on
    // the host; its job is to let the loader fiber activate so the
    // client-modules scanner resolves the package and serves client.js.
    name: PACKAGE_ID,
    entry: ['src/index.ts'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: true,
  },
  {
    // Browser half: served at /plugins/<PACKAGE_ID>/client.js.
    name: `${PACKAGE_ID}/client`,
    entry: ['src/client/index.ts'],
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    dts: false,
    sourcemap: true,
    clean: false,
    deps: {
      // Resolved from the loader module table at bundle load time.
      neverBundle: CLIENT_EXTERNALS,
      // tsdown auto-externalizes package dependencies; the module table only
      // answers the explicit externals above, so everything else must inline.
      alwaysBundle: (id: string) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
    },
    plugins: [
      {
        // Bundle purity gate: a @deepseek-ai value import that is neither a
        // platform module nor inlined is a guaranteed runtime require miss.
        name: 'dsh-noletme-client-purity',
        resolveId(source: string) {
          if (!source.startsWith('@deepseek-ai/')) return null
          if (CLIENT_EXTERNALS.includes(source)) return null
          throw new Error(
            `client bundle purity: "${source}" is not a platform module (CLIENT_EXTERNALS). `
            + 'Cross-plugin value imports are forbidden; use type-only imports or cordis services.',
          )
        },
      },
      {
        // Inline *.module.css: compile to a hashed class map + a <style> tag
        // injected at factory execution (same contract as the harness build).
        name: 'dsh-noletme-css-modules-inline',
        resolveId(source: string, importer: string | undefined) {
          if (!source.endsWith('.module.css')) return null
          const abs = importer !== undefined ? sourceAssetPath(source, importer) : source
          return CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX
        },
        async load(virtualId: string) {
          if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
          const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
          this.addWatchFile(fileId)
          const source = await readFile(fileId)
          const { code, exports: cssExports } = transform({
            filename: fileId,
            code: source,
            cssModules: { pattern: '[hash]_[local]' },
            minify: true,
          })
          const classMap: Record<string, string> = {}
          for (const [local, exp] of Object.entries(cssExports ?? {})) classMap[local] = exp.name
          const tagId = `${PACKAGE_ID}/${basename(fileId)}`
          return [
            `const css = ${JSON.stringify(code.toString())};`,
            `const tagId = ${JSON.stringify(tagId)};`,
            'if (typeof document !== \'undefined\' && document.querySelector(\'style[data-plugin-css=\' + JSON.stringify(tagId) + \']\') === null) {',
            '  const tag = document.createElement(\'style\');',
            `  tag.dataset.plugin = ${JSON.stringify(PACKAGE_ID)};`,
            '  tag.dataset.pluginCss = tagId;',
            '  tag.textContent = css;',
            '  document.head.appendChild(tag);',
            '}',
            `export default ${JSON.stringify(classMap)};`,
          ].join('\n')
        },
      },
    ],
    outputOptions: {
      entryFileNames: 'client.js',
      sourcemapPathTransform: browserSourcePath,
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PACKAGE_ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
