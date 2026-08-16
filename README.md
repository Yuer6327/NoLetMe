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

## Background

The keyword list is grounded in the public investigation of the **DeepSeek V4
Pro GA 0813** post-training overfitting event: the RL checkpoints trained on
DeepSeek Harness's **Minimal** preset (the "exact RL prompt and schemas"
two-tool scaffold) collapse on the wider Standard catalog — 99/96 in Minimal vs
91/92 in Standard/PTC on Project2 V4.1b. Trajectory word counts separate the
two modes cleanly: `we`/`let's` with **zero** `let me` (minimal), vs `let me`
in the hundreds (standard).

Full evidence and the event write-up: [`docs/research.md`](docs/research.md).

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

### Development overlay (no install)

Build once, then run with a patch overlay that points at the package:

```sh
pnpm install && pnpm build
dsh web --patch 'D:/OneDrive/桌面/play/codes/dsh-plugin/NoLetMe/cordis.patch.yml'
```

For a raw source overlay the row in `cordis.patch.yml` can name the package
directory directly:

```yaml
- insert:
    - id: noletme
      name: 'D:/OneDrive/桌面/play/codes/dsh-plugin/NoLetMe'
```

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

- The panel sits **top-right**, floating over the conversation frame.
- **Expanded** card: live status strip (streaming dot, reasoning blocks /
  chars, visible replies), trajectory-mode badge, per-category share bars,
  raw research metrics (`we · let's · let me · I`), the keyword breakdown, and
  a hesitation-pressure health note.
- Click the header chevron to **collapse** into a small mode pill (state is
  remembered). Click the pill to expand again.
- Stats are per-session and reset when you switch sessions. No data leaves
  your browser.

## Architecture

```
src/
├── index.ts            # Node (host) half — no-op, satisfies the Loader
└── client/
    ├── index.ts        # browser bundle entry (apply/inject)
    ├── apply.ts        # registers the shell.overlay entry
    ├── slots.ts        # inject-face + composed-props contracts
    ├── session-source.ts # current-session ConversationSnapshot observable
    ├── keywords.ts     # the research-backed taxonomy
    ├── stats.ts        # counting engine (longest-match walk, per-block cache)
    ├── NoLetMePanel.tsx / .module.css
    └── locales.ts      # zh + en dictionaries
```

- Reasoning streams arrive as `reasoning-delta` chunks; the session layer
  accumulates them into `ConversationSnapshot.partial` (published at most once
  per animation frame). Finalized turns land in `snapshot.nodes`. The panel
  folds both, caching counts per block object so each stream delta only
  recounts the block that actually changed.
- `shell.overlay` is the layout's frame-wide additive seat; the panel is a
  click-through-opt-in floating card that mirrors the DetailsPanel styling.

## License

[MIT](LICENSE)
