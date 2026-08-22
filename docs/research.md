# Keyword-list research basis

NoLetMe's three categories are not guesses — they are the lexical fingerprints
measured on real V4 Pro reasoning trajectories during the 2026-08 DeepSeek
V4 Pro GA 0813 overfitting investigation. This page records the event, the
evidence, and how each keyword maps back to it.

## The event

DeepSeek V4 Pro GA (0813) scores dramatically better inside DeepSeek Harness
(DSH) **Minimal** mode than in the Standard/Creator/Code modes — 99/96 on
Project2 V4.1b versus 91–92. The community diagnosis: the RL post-training
overfit the *exact* prompt and tool schemas of the harness's Minimal scaffold
(`bash` + `str_replace_editor`, the persona "You are a helpful software
engineer assistant.", `complete: true`, no runtime context, no compaction) that
was used during RL rollout. Under the wider 25-tool Standard catalog the same
weights fall into a visibly different — and weaker — reasoning style.

Key sources:

- [modeltest docs/v4.1](https://github.com/xiaobright/modeltest/blob/main/docs/v4.1)
  — trajectory, harness, and trigger-mechanism analyses (2026-08-14):
  - `DEEPSEEK_V4_PRO_HARNESS_ANALYSIS_20260814.md`
  - `DEEPSEEK_V4_TRAJECTORY_ANALYSIS_20260814.md`
  - `DEEPSEEK_V4_TRIGGER_MECHANISM_EXPERIMENTS_20260814.md`
- [DeepSeek V4-Pro GA 0813 Analysis: How Chain-of-Thought Overfitting Crippled Real-World Performance](https://www.ctol.digital/news/deepseek-v4-pro-ga-0813-cot-overfitting-analysis/)
- [DeepSeev-V4-Pro被冤枉了？性能时好时坏，真相可能藏在「极简模式」里？](https://news.qq.com/rain/a/20260816A036T700)
- [V4P 0813或许还有反转？](https://locdd.com/t/topic/80844)
- [DeepSeek Harness的过拟合问题测试](https://locdd.com/t/topic/80893)

## The measured fingerprints

Word counts are case-insensitive boundary matches over *reasoning* blocks only
(completed assistant messages; streamed chunks excluded to avoid double
counting). `we`/`let me`/`let's` are the decisive axes.

| trajectory | Ability | reasoning blocks | p50 chars | `we` | `let me` | `let's` | `I` | visible replies |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| Pro minimal 1 (DSH/WSL/max) | 99 | 177 | 235 | 272 | **0** | 101 | 17 | 1 |
| Pro minimal 2 (DSH/WSL/max) | 96 | 150 | 239 | 231 | **0** | 117 | 18 | 1 |
| Pro anchored-standard r1 | 98 | 193 | 111 | 179 | **1** | 88 | 17 | 1 |
| Pro anchored-standard r2 | 99 | 162 | 144 | 165 | **0** | 98 | 18 | 1 |
| Pro standard (DSH/WSL/max) | 91 | 99 | 437 | 11 | **208** | 2 | 137 | 55 |
| Pro PTC (DSH/WSL/max) | 92 | 94 | 550 | 16 | **194** | 0 | 237 | 33 |
| Pro formal worst (OpenCode) | 93 | 119 | 973 | 17 | 249 | 1 | 216 | 37 |

Takeaways:

- **`we` + `let's`, zero `let me`** → the high-scoring "minimal-like"
  trajectory (99/96, 98/99).
- **`let me` in the hundreds** → the low-scoring "standard-like" trajectory
  (91/92). The two anchored runs carried **one** `let me` across 355 blocks —
  presence alone is a signal.
- Reasoning blocks are short (p50 ≈ 111–239 chars) and the agent keeps its
  progress in reasoning, publishing one visible reply at the end (1 vs 55).

The trigger-mechanism probes add the **opening frames**:

- Minimal persona + two tools → first block opens `We need …`.
- Standard 25-tool catalog → `The user wants … Let me …`.
- Anchored (narrow first step, then full tools) → `Need …` openers after the
  promotion.
- Conservative lexical classifier: first-line `We need` + bare `we` + no
  `let me` → `minimal-like`; any `let me` → `standard-like`; else ambiguous.

## The taxonomy

### 高效推理 (efficient) — direct action, minimal-like

- `we need` — the opening frame of the high-scoring runs.
- `we should` / `we can` / `we will` — collective-action framing.
- `let's` — 88–117 occurrences in high scores, 0–2 in Standard/PTC.
- `good.` / `great.` / `excellent.` — standalone first-line affirmations
  (28/16 blocks in the two minimal runs; a *weak* fingerprint on its own).

### 低效犹豫 (hesitant) — deliberation, standard-like

- `let me` — zero in minimal, 194–249 in Standard/PTC. The dominant marker.
- `i think` / `i'm not sure` / `i'm not certain` / `i wonder` / `i guess` /
  `i should` — first-person deliberation and hedging.
- `maybe` / `perhaps` — hedging words.
- raw `I` / `I'm` / `I'll` first-person count — shown as a metric (137–237 in
  Standard/PTC vs 17–18 in minimal).

### 中性转述 (neutral) — reflective framing, the Standard-catalog opening

- `the user wants` — the exact Standard-catalog opening frame
  (`The user wants … Let me …`).
- `the user asked` / `the user is asking` / `the user needs` /
  `the user would like` — other user-address frames.
- `this task` / `the request` — task-description framing.

## Honest limits

These words are **trajectory fingerprints, not proofs**. The analyses
explicitly warn that a single `We`/`Good`/`Let me` does not identify a backend,
a route, or a checkpoint, and Flash shifts style without a score change. The
panel is a diagnostic mirror of the agent's current reasoning style, not a
model identity test.

## Gray-test probe (current turn, independent of 0813)

The 0813 taxonomy above is **session-wide** and stays frozen (`KEYWORD_TAXONOMY_VERSION = 1`,
`CLASSIFIER_VERSION = 1`). Community gray tests in 2026-06 (expert-mode Markdown CoT),
2026-07 (Web “summary” / 一段一段的总结性 CoT), and 2026-08-19/08-20 (V4 Pro
`I'm doing` reruns on dsh Standard + web Chat) use a **different** fingerprint
that the 0813 word list cannot see: `Let me` is often absent, `I'm doing` /
`I am doing` returns, CoT is outline-shaped or chunked, and reasoning sometimes
leaks dirty tokens (`Nameeee`, `antml:thinking`) or backend strings
(`fp_v4pro_20260812_prod`).

NoLetMe therefore adds a second, current-turn-only probe (`graytest.ts`,
`GRAYTEST_VERSION = 1`) that does **not** rewrite the 0813 classifier:

| signal | why |
|---|---|
| `I'm doing` / `I am doing` (incl. jammed `I'mdoing`) | 08-19/08-20 gray fingerprint; 0813 GA reportedly never produced it |
| opener is `I'm doing…` | stronger than a mid-block occurrence |
| outline / list CoT (`-` / `1.` / `#` density) | 06 expert-mode + 07 “摘要形思维链” |
| several mid-length reasoning blocks **and** another gray signal | community “段尾停顿、下一段突然一大段” — cadence is not in the snapshot, so this is supporting only |
| dirty tokens / `fp_…` strings | leaked in reasoning during 08-19 discussion; shown as details, not as identity |

Scoring is conservative: a lone 0813 `Let me` / `We need` trajectory is a **miss**;
`I'm doing` without `Let me` is a **hit**. The probe never counts `text` blocks.
A gray hit does **not** prove routing (Claude / Fable / Qwen); it reports that
this round matches the community gray cluster.

## Counting scope: reasoning blocks only

`evaluator/trajectory_evidence/analyze_trajectory_exports.py` counts the
keyword metrics (`we`, `let me`, `let's`, `i`) over **`reasoning` blocks
only**; `text` blocks contribute only `visible_blocks`/`visible_chars`
(block count and character length). NoLetMe mirrors that exactly — the
keyword breakdown, mode, and health figures come from reasoning blocks
alone.

Because some models stream their entire output as visible text with no
reasoning blocks, NoLetMe also tracks the text totals as a **diagnostic**:
when a conversation carries visible text but zero (or under ~5% of the
output as) reasoning, the panel shows a reasoning-health alert and reports
the raw counts instead of fabricating a trajectory from the text. The
keyword stats are never computed over text.
