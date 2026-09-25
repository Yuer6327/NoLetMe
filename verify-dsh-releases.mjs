/**
 * Static per-release contract probe for the dsh 0.1.x line.
 *
 * DSH STORE keeps a rolling window of the newest three non-deprecated
 * `@deepseek-ai/dsh` releases (by publish time) and unlists entries whose
 * `dsh.compatibility.dshReleases` matrix has no exact `compatible` record
 * inside that window. This script is the evidence tool for that matrix:
 *
 *   node verify-dsh-releases.mjs check
 *     Compare the current window against the matrix declared in
 *     package.json. Exit 0 = every window version is declared,
 *     exit 2 = some window version is undeclared, exit 1 = the npm
 *     registry could not be read (fail closed, declare nothing).
 *
 *   node verify-dsh-releases.mjs probe <version> [<version> ...]
 *     Download the npm tarballs of every contract package this bundle
 *     touches at the given dsh release(s) and verify the four faces:
 *     the dsh-web-frontend platform seed table, dsh-client-ui-layout's
 *     `shell.overlay` slot declaration, dsh-client-ui-chat's
 *     `chat.legacy` slice, and dsh-api-session-controller's SessionFace.
 *     Exit 0 = every probe passed on every version, exit 1 otherwise.
 *
 * A probe pass is static distribution evidence only — it is not live
 * Profile acceptance and must not be reported as one.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REGISTRY = 'https://registry.npmjs.org'
const ROOT = dirname(fileURLToPath(import.meta.url))
const PACKAGE = '@deepseek-ai/dsh'

/** Contract packages unpacked once per probed dsh release. */
const CONTRACT_PACKAGES = [
  'dsh-web-frontend',
  'dsh-client-ui-layout',
  'dsh-client-ui-chat',
  'dsh-api-session-controller',
]

/** Seeds the browser bundle may `require` at runtime (frozen rc.7∩…∩0.1.7 set). */
const REQUIRED_SEEDS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
]

const mismatches = []
const fail = (message) => mismatches.push(message)
const pass = (message) => console.log(`✓ ${message}`)

async function fetchJson(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`)
  return response.json()
}

/**
 * The newest three non-deprecated releases of `@deepseek-ai/dsh` by publish
 * time — the same rolling window DSH STORE's automation uses.
 */
function windowVersions(packument) {
  const entries = Object.entries(packument.time)
    .filter(([version]) => version !== 'created' && version !== 'modified')
    .filter(([version]) => packument.versions[version]?.deprecated === undefined)
  entries.sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
  return entries.slice(-3).map(([version]) => version)
}

function declaredVersions() {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  return manifest.dsh?.compatibility?.dshReleases ?? {}
}

async function check() {
  let packument
  try {
    packument = await fetchJson(`${REGISTRY}/${encodeURIComponent(PACKAGE)}`)
  } catch (error) {
    console.error(`✗ npm registry unreadable, failing closed: ${error.message}`)
    process.exitCode = 1
    return
  }
  const window_ = windowVersions(packument)
  const declared = declaredVersions()
  const undeclared = window_.filter((version) => declared[version] !== 'compatible')
  for (const version of window_) {
    const state = declared[version] === 'compatible' ? 'declared compatible' : `NOT declared (${declared[version] ?? 'missing'})`
    console.log(`window: ${version} — ${state}`)
  }
  if (undeclared.length > 0) {
    console.error(`\nundeclared window versions: ${undeclared.join(', ')}`)
    process.exitCode = 2
  } else {
    console.log('\nwindow fully covered by dshReleases matrix ✓')
  }
}

/** Download and extract one npm package tarball into `dir`, return its package/ root. */
async function unpack(dir, name, version) {
  const doc = await fetchJson(`${REGISTRY}/${encodeURIComponent(name)}/${version}`)
  const tarballUrl = doc.dist?.tarball
  if (!tarballUrl) throw new Error(`${name}@${version}: no dist.tarball in registry metadata`)
  const response = await fetch(tarballUrl)
  if (!response.ok) throw new Error(`${tarballUrl} -> HTTP ${response.status}`)
  // GNU tar reads `C:` in absolute paths as a remote host, so keep every tar
  // argument relative and run it with cwd pinned to the temp dir.
  const safe = name.replace(/[@/]/g, '-')
  const tgzName = `${safe}-${version}.tgz`
  writeFileSync(join(dir, tgzName), Buffer.from(await response.arrayBuffer()))
  mkdirSync(join(dir, safe), { recursive: true })
  const tar = spawnSync('tar', ['xzf', tgzName, '-C', safe], { cwd: dir, stdio: 'ignore' })
  if (tar.error || tar.status !== 0) throw new Error(`tar extraction failed for ${name}@${version}`)
  const root = join(dir, safe, 'package')
  if (!existsSync(root)) throw new Error(`${name}@${version}: tarball has no package/ root`)
  return root
}

function readIfPresent(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : null
}

/** Probe 1: dsh-web-frontend platform seed table still contains the 7 required seeds. */
function probeSeedTable(dirs, version) {
  const assets = join(dirs['dsh-web-frontend'], 'dist', 'assets')
  const files = existsSync(assets) ? readdirSync(assets).filter((f) => f.endsWith('.js')) : []
  for (const file of files) {
    const source = readFileSync(join(assets, file), 'utf8')
    const marker = source.match(/react\/jsx-runtime["']\s*:\s*[\w$]+[^}]*?dsh-client-ui-slots/)
    if (!marker) continue
    const start = source.lastIndexOf('{', marker.index)
    const end = source.indexOf('}', marker.index)
    const table = source.slice(start, end + 1)
    const keys = [...table.matchAll(/["']?([@A-Za-z0-9/_\-.]+?)["']?\s*:/g)].map((m) => m[1])
    const missing = REQUIRED_SEEDS.filter((seed) => !keys.includes(seed))
    if (missing.length > 0) fail(`dsh ${version}: seed table missing ${missing.join(', ')}`)
    else pass(`dsh ${version}: platform seed table (${keys.length} items) contains all ${REQUIRED_SEEDS.length} required seeds`)
    return
  }
  fail(`dsh ${version}: platform seed table not found in dsh-web-frontend dist assets`)
}

/** Probe 2: dsh-client-ui-layout still declares shell.overlay as {kind:'list', scope:'root'}. */
function probeShellOverlay(dirs, version) {
  const source = readIfPresent(join(dirs['dsh-client-ui-layout'], 'lib', 'client.js'))
  if (source === null) return fail(`dsh ${version}: dsh-client-ui-layout lib/client.js missing`)
  const block = source.match(/"shell\.overlay"\s*:\s*\{[^}]*\}/)
  if (!block) return fail(`dsh ${version}: shell.overlay slot declaration not found`)
  if (/kind\s*:\s*["']?list["']?/.test(block[0]) && /scope\s*:\s*["']?root["']?/.test(block[0]))
    pass(`dsh ${version}: shell.overlay is still {kind:'list', scope:'root'}`)
  else fail(`dsh ${version}: shell.overlay declaration changed: ${block[0].replace(/\s+/g, ' ')}`)
}

/** Probe 3: dsh-client-ui-chat still builds a chat.legacy slice carrying nodes/partial. */
function probeChatLegacy(dirs, version) {
  const source = readIfPresent(join(dirs['dsh-client-ui-chat'], 'lib', 'client.js'))
  if (source === null) return fail(`dsh ${version}: dsh-client-ui-chat lib/client.js missing`)
  for (const block of source.matchAll(/legacy\s*:\s*\{([^}]*)\}/g)) {
    const keys = [...block[1].matchAll(/([A-Za-z_$][\w$]*)\s*:/g)].map((m) => m[1])
    if (keys.includes('nodes') && keys.includes('partial')) {
      return pass(`dsh ${version}: chat.legacy slice keeps nodes/partial (keys: ${keys.join(', ')})`)
    }
  }
  fail(`dsh ${version}: no chat.legacy slice with nodes/partial found`)
}

/** Probe 4: dsh-api-session-controller SessionFace stays ISession & ObservableSnapshot + loadOlder. */
function probeSessionFace(dirs, version) {
  const types = join(dirs['dsh-api-session-controller'], 'lib', 'types')
  const files = []
  const walk = (node) => {
    for (const entry of readdirSync(node, { withFileTypes: true })) {
      const path = join(node, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name.endsWith('.d.ts')) files.push(path)
    }
  }
  if (existsSync(types)) walk(types)
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    if (!/SessionFace\s*=\s*ISession\s*&\s*ObservableSnapshot<SessionSnapshot>/.test(source)) continue
    if (/loadOlder\s*\(\s*\)\s*:\s*Promise\s*<\s*void\s*>/.test(source))
      return pass(`dsh ${version}: SessionFace = ISession & ObservableSnapshot<SessionSnapshot> with loadOlder()`)
    return fail(`dsh ${version}: SessionFace composition unchanged but loadOlder() missing`)
  }
  fail(`dsh ${version}: SessionFace type alias not found in dsh-api-session-controller types`)
}

const PROBES = [probeSeedTable, probeShellOverlay, probeChatLegacy, probeSessionFace]

async function probe(versions) {
  for (const version of versions) {
    const dir = mkdtempSync(join(tmpdir(), `dsh-probe-${version.replace(/\./g, '-')}-`))
    try {
      const dirs = {}
      for (const name of CONTRACT_PACKAGES) dirs[name] = await unpack(dir, `@deepseek-ai/${name}`, version)
      for (const probeFn of PROBES) probeFn(dirs, version)
    } catch (error) {
      fail(`dsh ${version}: probe setup failed — ${error.message}`)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

async function main() {
  const [command, ...versions] = process.argv.slice(2)
  if (command === 'check') {
    await check()
  } else if (command === 'probe') {
    if (versions.length === 0) {
      console.error('usage: node verify-dsh-releases.mjs probe <version> [<version> ...]')
      process.exitCode = 1
      return
    }
    await probe(versions)
  } else {
    console.error('usage: node verify-dsh-releases.mjs <check|probe [versions...]>')
    process.exitCode = 1
    return
  }
  if (mismatches.length > 0) {
    for (const mismatch of mismatches) console.error(`✗ ${mismatch}`)
    process.exitCode = 1
  }
}

await main()
