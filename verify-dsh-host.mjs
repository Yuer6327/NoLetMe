import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const root = dirname(fileURLToPath(import.meta.url))
const platformModules = JSON.parse(
  readFileSync(join(root, 'src/client/platform-modules.json'), 'utf8'),
)
if (!Array.isArray(platformModules) || platformModules.length === 0) {
  console.error('✗ src/client/platform-modules.json is missing or empty')
  process.exitCode = 1
}

const minimum = '0.1.0-rc.7'
const packages = [
  '@deepseek-ai/dsh-client-locale',
  '@deepseek-ai/dsh-client-runtime',
  '@deepseek-ai/dsh-client-ui-layout',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-slots',
]

/**
 * Compare two npm versions including prerelease tags (`0.1.0-rc.7` < `0.1.0-rc.8` < `0.1.0`).
 * @param a - left version
 * @param b - right version
 * @returns negative when a < b
 */
function compareNpm(a, b) {
  const parse = (v) => {
    const [core, pre] = v.split('-')
    const nums = core.split('.').map(n => Number.parseInt(n, 10))
    return { nums, pre: pre ?? '' }
  }
  const left = parse(a)
  const right = parse(b)
  for (let i = 0; i < 3; i++) {
    const d = (left.nums[i] ?? 0) - (right.nums[i] ?? 0)
    if (d !== 0) return d
  }
  if (left.pre === right.pre) return 0
  if (left.pre === '') return 1
  if (right.pre === '') return -1
  return left.pre < right.pre ? -1 : left.pre > right.pre ? 1 : 0
}

const mismatches = []
for (const name of packages) {
  let version
  try {
    version = require(`${name}/package.json`).version
  } catch (error) {
    mismatches.push(`${name}: package metadata unavailable (${error.message})`)
    continue
  }
  const majorMinor = version.split('.').slice(0, 2).join('.')
  if (majorMinor !== '0.1') mismatches.push(`${name}: expected 0.1.x, found ${version}`)
  else if (compareNpm(version, minimum) < 0) mismatches.push(`${name}: expected >= ${minimum}, found ${version}`)
  else console.log(`✓ ${name}@${version}`)
}

const requiredSeeds = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
]
for (const seed of requiredSeeds) {
  if (!platformModules.includes(seed)) mismatches.push(`platform-modules.json missing seed "${seed}"`)
  else console.log(`✓ platform seed ${seed}`)
}

const droppedInRc8 = [
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
]
for (const seed of droppedInRc8) {
  if (platformModules.includes(seed)) mismatches.push(`platform-modules.json still externalizes rc.8-dropped seed "${seed}"`)
}

if (mismatches.length > 0) {
  for (const mismatch of mismatches) console.error(`✗ ${mismatch}`)
  process.exitCode = 1
} else {
  console.log(`\ndsh >= ${minimum} (0.1.x) dependency + platform-seed contract verified ✓`)
}
