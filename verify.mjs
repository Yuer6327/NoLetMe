/**
 * Quick smoke test for the NoLetMe counting engine, using the research
 * trajectory data. Run: node --experimental-strip-types verify.mjs
 */
import { countReasoningText } from './src/client/stats.ts'
import { GROUPS, PATTERNS } from './src/client/keywords.ts'

let failures = 0
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) {
    failures++
    console.error(`✗ ${name}\n    expected ${JSON.stringify(expected)}\n    actual   ${JSON.stringify(actual)}`)
  } else {
    console.log(`✓ ${name}`)
  }
}

// --- 1. Direct-action trajectory (minimal-like) ---
const minimal = `
We need to inspect the project layout. Let's check the config file.
We should run the tests to confirm nothing broke. Good.
We can then open the editor to patch the build script.
`
{
  const c = countReasoningText(minimal)
  const byGroup = {}
  for (const g of GROUPS) {
    byGroup[g] = 0
    for (let i = 0; i < PATTERNS.length; i++) if (PATTERNS[i].group === g) byGroup[g] += c.patterns[i]
  }
  check('minimal: words.we', c.words.we, 3)          // 3 bare "we"
  check('minimal: words.lets', c.words.lets, 1)      // one Let's
  check('minimal: words.letMe', c.words.letMe, 0)
  check('minimal: groups.efficient >= 3', byGroup.efficient >= 3, true)
  check('minimal: groups.hesitant === 0', byGroup.hesitant, 0)
}

// --- 2. Hesitant trajectory (standard-like) ---
const standard = `
The user wants me to fix the build. Let me think about how to approach this.
Let me check the logs first. I'm not sure where the error is coming from.
Maybe I should look at the recent changes. Let me try a different approach.
The user is asking for a quick fix. I think the issue is in the config.
`
{
  const c = countReasoningText(standard)
  const byGroup = {}
  for (const g of GROUPS) {
    byGroup[g] = 0
    for (let i = 0; i < PATTERNS.length; i++) if (PATTERNS[i].group === g) byGroup[g] += c.patterns[i]
  }
  check('standard: words.letMe', c.words.letMe, 3)
  check('standard: words.we', c.words.we, 0)
  check('standard: groups.hesitant >= 4', byGroup.hesitant >= 4, true)
  check('standard: groups.neutral >= 2', byGroup.neutral >= 2, true)  // "The user wants" + "The user is asking"
}

// --- 3. blockStart only matches the first token ---
{
  const c = countReasoningText('This is fine. Great, we can continue. Good.')
  // "Great" and "Good" appear mid-block → blockStart patterns must NOT match.
  // The first token is "this" → no blockStart match at all.
  const goodIdx = PATTERNS.findIndex(p => p.label === 'pattern.good')
  const greatIdx = PATTERNS.findIndex(p => p.label === 'pattern.great')
  check('blockStart: good not counted mid-block', c.patterns[goodIdx], 0)
  check('blockStart: great not counted mid-block', c.patterns[greatIdx], 0)
}
{
  const c = countReasoningText('Good. We can proceed directly.')
  const goodIdx = PATTERNS.findIndex(p => p.label === 'pattern.good')
  check('blockStart: good counted at block start', c.patterns[goodIdx], 1)
}

// --- 4. Longest-match subsumption: "let me" consumed, no double count ---
{
  const c = countReasoningText('Let me think about it. Let me check again.')
  check('subsumption: let me = 2', c.words.letMe, 2)
}

// --- 5. Research-fidelity: a single let-me in 355 blocks is a signal ---
{
  const c = countReasoningText('We need to verify the pipeline. Let\'s move on. We should finish this.')
  check('fidelity: letMe 0 for direct-action text', c.words.letMe, 0)
  check('fidelity: we present', c.words.we, 2)
}

// --- 6. formatCount scaling ---
{
  const fmt = (await import('./src/client/stats.ts')).formatCount
  check('format: 517', fmt(517), '517')
  check('format: 12400', fmt(12400), '12.4K')
  check('format: 1200000', fmt(1200000), '1.2M')
}

// --- 7. Session fold: computeStats over a mock snapshot (finalized + partial) ---
{
  const { computeStats } = await import('./src/client/stats.ts')
  const node = {
    kind: 'assistant',
    seq: 1,
    time: 0,
    turn: 1,
    step: 1,
    blocks: [
      { kind: 'reasoning', text: 'We need to check the build.' },
      { kind: 'reasoning', text: 'Let me verify the config first.' },
      { kind: 'text', text: 'Here is the result.' },
    ],
  }
  const stats = computeStats({
    sessionId: 's1',
    nodes: [node],
    partial: { turn: 2, step: 1, blocks: [{ kind: 'reasoning', text: 'Good. Let\'s proceed.' }] },
  })
  check('fold: blocks = 3', stats.blocks, 3)
  check('fold: replies = 1', stats.replies, 1)
  check('fold: streaming true', stats.streaming, true)
  check('fold: words.we = 1', stats.words.we, 1)
  check('fold: words.letMe = 1', stats.words.letMe, 1)
  check('fold: words.lets = 1', stats.words.lets, 1)
  check('fold: mode hesitant (let me present)', stats.mode, 'hesitant')
  check('fold: efficient >= 1 (we need + let\'s)', stats.groups.efficient >= 1, true)
  check('fold: null on no snapshot', computeStats(undefined), null)
}

console.log(failures === 0 ? '\nAll checks passed ✓' : `\n${failures} check(s) FAILED ✗`)
process.exit(failures === 0 ? 0 : 1)
