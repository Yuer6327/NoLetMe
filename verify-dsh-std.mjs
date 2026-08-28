/**
 * Static Community v0.15 contract for NoLetMe.
 *
 * Does not depend on @dsh-std/* — the spec allows any conforming shape.
 * Run: node --experimental-strip-types verify-dsh-std.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
let failures = 0

function check(name, actual, expected) {
  const ok = actual === expected
  if (!ok) {
    failures++
    console.error(`✗ ${name}\n    expected ${JSON.stringify(expected)}\n    actual   ${JSON.stringify(actual)}`)
  } else {
    console.log(`✓ ${name}`)
  }
}

function checkTrue(name, value) {
  if (!value) {
    failures++
    console.error(`✗ ${name}`)
  } else {
    console.log(`✓ ${name}`)
  }
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const manifest = JSON.parse(readFileSync(join(root, 'dsh-plugin.json'), 'utf8'))

check('$schema', manifest.$schema, 'urn:dsh-std:community-draft:dsh-plugin:0.15')
check('manifestVersion', manifest.manifestVersion, '0.15')
check('id', manifest.id, 'io.github.yuer6327.noletme')
check('name', manifest.name, 'NoLetMe')
check('version matches package.json', manifest.version, pkg.version)
check('host.entry', manifest.facets?.host?.entry, 'lib/std/host.js')
check('host.apiVersion', manifest.facets?.host?.apiVersion, 'v1alpha1')
check('license', manifest.license, 'MIT')
check('source.repository', manifest.source?.repository, 'https://github.com/Yuer6327/NoLetMe.git')
checkTrue('package.json files includes dsh-plugin.json', Array.isArray(pkg.files) && pkg.files.includes('dsh-plugin.json'))
checkTrue('keywords includes dsh-std', Array.isArray(pkg.keywords) && pkg.keywords.includes('dsh-std'))
checkTrue('keywords includes community-v0.15', Array.isArray(pkg.keywords) && pkg.keywords.includes('community-v0.15'))
checkTrue('native dsh.client retained', pkg.dsh?.client?.platform === 'web' && pkg.dsh?.client?.immediately === true)
const inject = pkg.dsh?.client?.inject
checkTrue('dsh.client.inject is a string array', Array.isArray(inject) && inject.every(item => typeof item === 'string'))
checkTrue(
  'dsh.client.inject omits removed dsh-client-runtime',
  Array.isArray(inject) && !inject.includes('@deepseek-ai/dsh-client-runtime'),
)
checkTrue(
  'dsh.client.inject still waits for locale + ui-layout',
  Array.isArray(inject)
    && inject.includes('@deepseek-ai/dsh-client-locale')
    && inject.includes('@deepseek-ai/dsh-client-ui-layout'),
)

const idOk = /^[a-z][a-z0-9]*(?:[.-][a-z0-9][a-z0-9-]*)+$/.test(manifest.id)
checkTrue('id is a namespaced id', idOk)

const host = await import(pathToFileURL(join(root, 'src/std/host.ts')).href)
const facet = host.default
checkTrue('host default export has activate()', typeof facet?.activate === 'function')
checkTrue('host default export has snapshot()', typeof facet?.snapshot === 'function')
checkTrue('named stdFacet is the default', host.stdFacet === facet)

const scope = { signal: AbortSignal.abort(), add: () => () => undefined }
await facet.activate({ scope })
const snap = await facet.snapshot()
check('snapshot.state', snap.state, 'active')
checkTrue('snapshot.message mentions native client', typeof snap.message === 'string' && snap.message.includes('dsh.client'))
await facet.deactivate?.('verify')

if (failures > 0) {
  console.error(`\n${failures} dsh-std checks failed`)
  process.exitCode = 1
} else {
  console.log('\ndsh-std Community v0.15 contract verified ✓')
}
