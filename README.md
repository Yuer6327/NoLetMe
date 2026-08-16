# NoLetMe · dsh reasoning-trajectory panel

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh)
web plugin that adds a **real-time reasoning-keyword statistics panel** to the
right edge of the conversation page.

While the model streams, NoLetMe watches its **reasoning blocks** and counts
keywords that fingerprint *how* it is thinking:

| 分类 | 关键词 | 依据 |
|---|---|---|
| 🟢 高效推理 · 直接行动 | `We need…` `Let's…` `We should…` `We can…` `We will…` + 首行 `Good.`/`Great.`/`Excellent.` | minimal-like 高分轨迹 |
| 🟠 低效犹豫 · 第一人称试探 | `Let me…` `I think…` `I'm not sure…` `I wonder…` `I guess…` `maybe` `perhaps` | standard-like 低分轨迹 |
| ⚪ 中性转述 · 复述任务 | `The user wants…` `The user asked…` `this task…` `the request…` | Standard 目录开场框架 |

It is a native-feeling overlay: the panel reuses the harness design system
(`--dsw-alias-*` semantic tokens, the DetailsPanel header/body idiom, CSS
Modules, light/dark and reduced-motion preserved) and mounts through the
official `shell.overlay` slot — nothing in the shipped UI is replaced or
patched.

## 数据来源与证据链 (Data sources & evidence chain)

The keyword taxonomy is **not invented** — every category traces to the public
[xiaobright/modeltest](https://github.com/xiaobright/modeltest) repository and
its investigation of the **DeepSeek V4 Pro GA 0813** post-training overfitting
event (the RL checkpoints trained on DeepSeek Harness's "Minimal" preset —
the "exact RL prompt and schemas" two-tool scaffold — collapse on the wider
Standard tool catalog).

**The test set.** Project2 V4.1b — a real broken ESP-IDF embedded-engineering
task, **formally frozen** ([`PROJECT_FROZEN.md`](https://github.com/xiaobright/modeltest/blob/main/PROJECT_FROZEN.md),
frozen 2026-07-23; scoring rules & hidden tests SHA-256-pinned 2026-07-19).

**The measured evidence.** `evaluator/trajectory_evidence/derived/trajectory_stats.json`
(SHA-256-pinned per run; counting over completed assistant reasoning blocks,
streaming chunks excluded):

| run (model / config) | Ability | `we` | `let me` | `let's` | `I` | visible replies |
|---|---|---:|---:|---:|---:|---:|
| V4 Pro / **Minimal** WSL | 99 | 272 | **0** | 101 | 17 | 1 |
| V4 Pro / **Minimal** WSL | 96 | 231 | **0** | 117 | 18 | 1 |
| V4 Pro / **anchored-standard** Win | 98 | 179 | **1** | 88 | 17 | 1 |
| V4 Pro / **anchored-standard** Win | 99 | 165 | **0** | 98 | 18 | 1 |
| V4 Pro / **Standard** WSL | 91 | 11 | **208** | 2 | 137 | 55 |
| V4 Pro / **PTC** WSL | 92 | 16 | **194** | 0 | 237 | 33 |

High-scoring runs (96–99) carry `we`/`let's` with `let me ≈ 0`; low-scoring
runs (91–92) carry `let me` in the hundreds. That clean separation is the
source of the 🟢 高效 / 🟠 犹豫 split.

**The classifier.** The repo ships the exact lexical rules
([`evaluator/trigger_probe/src/classifier.mjs`](https://github.com/xiaobright/modeltest/blob/main/evaluator/trigger_probe/src/classifier.mjs))
that NoLetMe mirrors: first-line `We need` → minimal-like; `we` present with no
`let me` → +2; any `let me` → standard-like; standalone `Good.`/`Great.`/
`Excellent.` first line → +1. The ⚪ 中性 category covers the remaining
`ambiguous`/reflective frame — the Standard-catalog opening `The user wants …
Let me …` recorded in
[`docs/v4.1/DEEPSEEK_V4_TRIGGER_MECHANISM_EXPERIMENTS_20260814.md`](https://github.com/xiaobright/modeltest/blob/main/docs/v4.1/DEEPSEEK_V4_TRIGGER_MECHANISM_EXPERIMENTS_20260814.md),
plus general task-description vocabulary.

**Honest limits.** The matrix warns verbatim: *"Lexical trajectory labels are
observational fingerprints, not route or identity labels."* Word counts
fingerprint a reasoning *style*; they do not identify a backend, a route, or a
checkpoint, and V4 Flash shifts style without a score change. NoLetMe is a
reasoning-style diagnostic, not a model identity test.

Full event write-up: [`docs/research.md`](docs/research.md).

## Install

Prerequisite: a dsh CLI (`dsh --version`), and a profile to install into.

```sh
cd /path/to/this/repo/..            # where NoLetMe/ lives
dsh plugin --profile demo add ./NoLetMe
dsh web --profile demo              # or just: dsh --profile demo
```

The bundle layer (`cordis.patch.yml`) inserts the `dsh-noletme` row; the
`dsh.client` block in `package.json` tells the web shell to serve the browser
bundle. The panel appears top-right in the web UI.

Install directly from GitHub (the `prepare` script builds `lib/` on install):

```sh
dsh plugin --profile demo add github:Yuer6327/NoLetMe
```

pnpm ≥10 blocks a git dependency's `prepare` script until allowlisted — copy
the exact package key pnpm prints into the profile's `pnpm-workspace.yaml`:

```yaml
allowBuilds:
  dsh-noletme: true
```

then re-run the `add`.

### Development (local source)

Rebuild after editing, then point the patch at the package:

```sh
pnpm install && pnpm build
dsh web --patch 'D:/OneDrive/桌面/play/codes/dsh-plugin/NoLetMe/cordis.patch.yml'
```

> **Windows note.** The `cordis.patch.yml` row uses the package name
> (`dsh-noletme`), so the overlay works only when the package is installed
> into the profile (the `dsh plugin --profile web add ./NoLetMe` step above).
> Naming the row with a raw absolute Windows path fails — the ESM loader
> rejects `D:\…` entry names (`ERR_UNSUPPORTED_ESM_URL_SCHEME`). On Linux a
> `file://` URL works as an alternative.

## Build

```sh
pnpm install      # devDependencies: tsdown, lightningcss, typescript, react types
pnpm typecheck    # optional; tsc --noEmit
pnpm build        # tsdown → lib/index.js (node half) + lib/client.js (browser bundle)
```

The browser bundle is a `window.__ModuleLoader__.load(...)` closure-factory
artifact (same shape as the harness's own `clientBundle` preset): platform
modules resolve through the frozen module table, everything else inlines, and
`*.module.css` compiles to a hashed class map with auto-injected styles.

## Usage

- The panel docks **below the session header** at the top-right (clears the
  "Session log" download action), floating over the conversation frame.
- **Collapsed** it is a compact rounded-rectangle chip (dot + "NoLetMe" +
  current mode); click it to expand into the card. **Expanded** it shows the
  live status strip (streaming/syncing dot, reasoning blocks / chars, visible
  replies), the trajectory-mode badge on the same row as its label,
  per-category share bars, raw research metrics (`we · let's · let me · I`),
  the keyword breakdown, and a hesitation-pressure health note.
- The chip↔card transition is a single surface that morphs on a
  critically-damped spring (interruptible, anchored at the right dock), and
  degrades to an instant swap under `prefers-reduced-motion`. The open state
  is remembered.
- The panel body's scrollbar is hover-revealed through the harness's own
  `--dsh-scrollbar-*` tokens (invisible until hovered).

### Data freshness, persistence, and privacy

- **Real-time**: stats fold incrementally on every streamed reasoning delta
  (at most once per animation frame) — nothing re-walks the conversation.
- **Session switching**: switching conversations immediately repaints the new
  session's stats from its local cache, then pages in the **complete history**
  (a "syncing" indicator shows meanwhile) so the count covers the whole
  conversation.
- **Local persistence**: each session's folded counts are stored in
  `localStorage` (`dsh-noletme.stats.<sessionId>`), so reopening a
  conversation does not recount it — only new messages are folded.
- **Robustness**: compaction rewrites reset the count once; history paging is
  capped and aborts when you switch away; storage failures are swallowed.
- No data leaves your browser.

## Architecture

```
src/
├── index.ts            # Node (host) half — no-op, satisfies the Loader
└── client/
    ├── index.ts        # browser bundle entry (apply/inject)
    ├── apply.ts        # registers the shell.overlay entry + the stats store
    ├── slots.ts        # inject-face + composed-props contracts
    ├── session-source.ts # current-session ConversationSnapshot observable
    ├── session-store.ts  # stats store: live folding, full-history paging, persistence
    ├── accumulator.ts  # per-session incremental fold + compaction + serialize
    ├── keywords.ts     # the research-backed taxonomy
    ├── stats.ts        # counting engine (longest-match walk, per-block cache)
    ├── NoLetMePanel.tsx / .module.css
    └── locales.ts      # zh + en dictionaries
```

- Reasoning streams arrive as `reasoning-delta` chunks; the session layer
  accumulates them into `ConversationSnapshot.partial` (published at most once
  per animation frame). Finalized turns land in `snapshot.nodes`. The stats
  store folds both **incrementally** (per-block counts cached by block
  identity, new nodes gated by a seq high-water mark) and republishes a ready
  `TrajectoryStats` — the panel never recomputes a session from scratch.
- `shell.overlay` is the layout's frame-wide additive seat; the panel is a
  click-through-opt-in floating surface that mirrors the DetailsPanel styling.

## License

[MIT](LICENSE)
