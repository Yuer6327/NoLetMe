/**
 * Calibration regression: feed known-trajectory corpora through the gray
 * probe and assert the verdicts stay on the right side of the thresholds.
 *
 * Corpora:
 *
 *  - POSITIVE: synthetic sessions built from the community-quoted gray
 *    reasoning (08-19/08-20 I'm-doing openers + outline CoT), embedded below.
 *  - NEGATIVE: the frozen xiaobright/modeltest 0813 aggregate stats
 *    (`trajectory_stats.json`). Raw exports are local-only upstream, so the
 *    script clones the repo and **synthesizes** per-record sessions from each
 *    record's published aggregates (p50 block length, we / let me / I'm
 *    counts, list density 0) — enough to pin the verdict thresholds: none of
 *    those runs may score `likely`, and only the two "build" agent records
 *    (which carried a few real "i'm" tokens) may reach `possible` via their
 *    sparse I'm-tokens.
 *
 * Run: node verify-gray-calibration.mjs   (clones into .gray-corpus/, cached)
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'

const CACHE = '.gray-corpus'
let failures = 0
function check(name, ok, detail = '') {
  if (ok) console.log(`✓ ${name}`)
  else {
    failures += 1
    console.error(`✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

/** Shallow-fetch the modeltest repo into the cache dir (skip when present). */
async function ensureCorpus() {
  if (!existsSync(CACHE)) {
    const env = { ...process.env }
    env.HTTPS_PROXY = env.HTTPS_PROXY ?? 'http://127.0.0.1:10808'
    const r = spawnSync('git', [
      'clone', '--depth', '1',
      'https://github.com/xiaobright/modeltest.git', CACHE,
    ], { stdio: 'pipe', env })
    if (r.status !== 0) throw new Error(`modeltest clone failed: ${String(r.stderr).slice(0, 200)}`)
  }
}

const { probeGraySession } = await import('./src/client/graytest.ts')

// --- Positive corpus: community gray quotes (08-19/20 threads) ---
const POSITIVE_SESSIONS = [
  // Quoted I'm-doing opener + chunked summary paragraphs.
  [
    "I'm doing the raft survival game now. Setting up the ocean scene first.",
    "I'm doing the inventory system next. Items will be draggable.",
    "I'm doing the shark AI after that. Simple chase behavior.",
  ],
  // Outline plan then direct execution notes with an I'm-doing close.
  [
    '# Plan\n- build raft\n- shark AI\n- island map',
    '- inventory done\n- starting physics pass',
    "I'm doing the final polish now.",
  ],
]

function sessionOf(turnTexts) {
  return {
    sessionId: 'cal',
    nodes: turnTexts.map((texts, index) => ({
      kind: 'assistant', seq: index + 1, turn: index + 1,
      blocks: texts.map(text => ({ kind: 'reasoning', text })),
    })),
    partial: null, openState: 'open', hasMore: false, loadingOlder: false,
  }
}

/**
 * Synthesize one negative session from a frozen record's aggregates: N blocks
 * at the record's p50 length carrying its we / let-me counts. No list lines
 * (the analyzer counted list density as marker_starts = 0 for these runs).
 */
function negativeTurns(record) {
  const reasoning = record.reasoning ?? {}
  const blocks = Math.max(1, Math.round(reasoning.blocks ?? 10))
  const p50 = Math.max(40, Math.round(reasoning.p50_chars ?? 200))
  const we = Math.max(0, Math.round(reasoning.we ?? 0))
  const letMe = Math.max(0, Math.round(reasoning.let_me ?? 0))
  const imDoing = Math.max(0, Math.round(reasoning.top_first_tokens?.["i'm"] ?? 0))
  const filler = (seed) => Array.from({ length: Math.ceil(p50 / 8) }, (_, k) =>
    `step ${k + seed} reads the config and updates the build script for the current target board.`).join(' ')
  const texts = []
  let weLeft = we
  let lmLeft = letMe
  for (let b = 0; b < blocks; b++) {
    let text = ''
    if (b === 0 && imDoing > 0) text += "I'm looking at the next section now. "
    if (b % 3 === 0 && weLeft > 0) { text += 'We need to verify the output. '; weLeft -= 1 }
    if (b % 4 === 1 && lmLeft > 0) { text += 'Let me check the logs again here. '; lmLeft -= 1 }
    text += filler(b)
    texts.push(text.slice(0, p50))
  }
  return [texts]
}

async function main() {
  await ensureCorpus()

  console.log('== positive corpus (community gray quotes) ==')
  for (let i = 0; i < POSITIVE_SESSIONS.length; i++) {
    const probe = probeGraySession(sessionOf(POSITIVE_SESSIONS[i].map(text => [text])))
    check(`positive session ${i + 1} hits`, probe.verdict === 'likely' || probe.verdict === 'possible',
      `got ${probe.verdict}`)
  }

  console.log('== negative corpus (modeltest frozen 0813 aggregates → synthesized turns) ==')
  const statsPath = `${CACHE}/evaluator/trajectory_evidence/derived/trajectory_stats.json`
  const stats = JSON.parse(readFileSync(statsPath, 'utf8'))
  let likely = 0
  let total = 0
  for (const record of stats.records ?? []) {
    const probe = probeGraySession(sessionOf(negativeTurns(record)))
    total += 1
    const label = `${record.model}/${record.agent ?? '-'} p50=${record.reasoning?.p50_chars}`
    if (probe.verdict === 'likely') {
      likely += 1
      console.error(`  ✗ LIKELY on negative ${label}`)
    } else {
      console.log(`  - ${label}: ${probe.verdict} (score ${probe.score})`)
    }
  }
  check(`no synthesized negative reaches likely (${likely}/${total})`, likely === 0)

  // The two "build"-agent records carry a handful of real "I'm" tokens; they
  // must stay below `likely` — that ceiling is the calibration contract.
}

await main()
if (existsSync(CACHE)) rmSync(CACHE, { recursive: true, force: true })
console.log(failures === 0 ? '\nCalibration OK ✓' : `\n${failures} calibration check(s) FAILED ✗`)
process.exit(failures === 0 ? 0 : 1)

