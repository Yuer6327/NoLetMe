import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const expected = '0.1.0-rc.7'
const packages = [
  '@deepseek-ai/dsh-client-locale',
  '@deepseek-ai/dsh-client-runtime',
  '@deepseek-ai/dsh-client-ui-layout',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
]

const mismatches = []
for (const name of packages) {
  let version
  try {
    version = require(`${name}/package.json`).version
  } catch (error) {
    mismatches.push(`${name}: package metadata unavailable (${error.message})`)
    continue
  }
  if (version !== expected) mismatches.push(`${name}: expected ${expected}, found ${version}`)
  else console.log(`✓ ${name}@${version}`)
}

if (mismatches.length > 0) {
  for (const mismatch of mismatches) console.error(`✗ ${mismatch}`)
  process.exitCode = 1
} else {
  console.log(`\ndsh ${expected} dependency contract verified ✓`)
}
