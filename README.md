<img width="1710" height="1082" alt="" src="https://github.com/user-attachments/assets/ef968872-f49b-4183-9b20-9e9fe6846466" />


# NoLetMe · dsh 推理轨迹面板

[![npm version](https://img.shields.io/npm/v/dsh-noletme)](https://www.npmjs.com/package/dsh-noletme)

NoLetMe 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）网页端插件，在会话页右侧边缘挂载一块**实时推理关键词统计面板**。

模型流式输出时，NoLetMe 只统计其**推理块（reasoning blocks）**中出现的特征词，据此反映当前推理风格：

| 分类 | 关键词 | 依据 |
|---|---|---|
| 🟢 高效 · 直接行动 | `We need…` `Let's…` `We should…` `We can…` `We will…`；首行 `Good.`/`Great.`/`Excellent.` | minimal 类高分轨迹 |
| 🟠 犹豫 · 第一人称试探 | `Let me…` `I think…` `I'm not sure…` `I wonder…` `I guess…` `maybe` `perhaps` | standard 类低分轨迹 |
| ⚪ 中性 · 复述任务 | `The user wants…` `The user asked…` `this task…` `the request…` | Standard 目录开场框架 |

面板是原生融入的悬浮层：复用 harness 设计系统（`--dsw-alias-*` 语义令牌、DetailsPanel 头/体结构、CSS Modules、明暗与 reduced-motion），通过官方 `shell.overlay` 插槽挂载，不改动、不补丁任何既有 UI。

## 证据链

本插件的分类体系**并非杜撰**，每一条都追溯至公开的 [xiaobright/modeltest](https://github.com/xiaobright/modeltest) 仓库，及其对 **DeepSeek V4 Pro GA 0813 后训练过拟合事件**的调研：在 DeepSeek Harness「Minimal」预设（RL 训练所用的双工具脚手架）上训练出的 checkpoint，换到更宽的 Standard 工具目录后能力崩塌。

**测试集**：Project2 V4.1b —— 一个真实损坏的 ESP-IDF 嵌入式工程任务，已**正式冻结**（[`PROJECT_FROZEN.md`](https://github.com/xiaobright/modeltest/blob/main/PROJECT_FROZEN.md)，2026-07-23 冻结；评分规则与隐藏测试于 2026-07-19 做 SHA-256 固定）。

**实测数据**：`evaluator/trajectory_evidence/derived/trajectory_stats.json`（每次运行做 SHA-256 固定；只统计已完成的助手推理块，排除流式分块）：

| 运行（模型 / 配置） | 得分 | `we` | `let me` | `let's` | `I` | 可见回复 |
|---|---:|---:|---:|---:|---:|---:|
| V4 Pro / **Minimal** WSL | 99 | 272 | **0** | 101 | 17 | 1 |
| V4 Pro / **Minimal** WSL | 96 | 231 | **0** | 117 | 18 | 1 |
| V4 Pro / **anchored-standard** Win | 98 | 179 | **1** | 88 | 17 | 1 |
| V4 Pro / **anchored-standard** Win | 99 | 165 | **0** | 98 | 18 | 1 |
| V4 Pro / **Standard** WSL | 91 | 11 | **208** | 2 | 137 | 55 |
| V4 Pro / **PTC** WSL | 92 | 16 | **194** | 0 | 237 | 33 |

高分运行（96–99）带 `we`/`let's`、`let me ≈ 0`；低分运行（91–92）`let me` 数以百计。这条干净的界线就是 🟢 高效 / 🟠 犹豫的划分来源。

**分类器**：仓库自带精确词法规则（[`evaluator/trigger_probe/src/classifier.mjs`](https://github.com/xiaobright/modeltest/blob/main/evaluator/trigger_probe/src/classifier.mjs)），NoLetMe 逐条镜像：首行 `We need` → minimal 类；有 `we` 无 `let me` → +2；出现任何 `let me` → standard 类；独立首行 `Good.`/`Great.`/`Excellent.` → +1。⚪ 中性类覆盖其余 `ambiguous`（模糊）及复述框架 —— Standard 目录开场 `The user wants … Let me …`（见 [`DEEPSEEK_V4_TRIGGER_MECHANISM_EXPERIMENTS_20260814.md`](https://github.com/xiaobright/modeltest/blob/main/docs/v4.1/DEEPSEEK_V4_TRIGGER_MECHANISM_EXPERIMENTS_20260814.md)），外加通用任务描述词汇。

**诚实边界**：原始矩阵原文警告：*"词法轨迹标签是观测性指纹，而非路由或身份标签。"* 词频只反映推理*风格*，不能判定后端、路由或 checkpoint；V4 Flash 会在分数不变时改变风格。NoLetMe 是推理风格诊断工具，不是模型身份测试。

完整事件报告见 [`docs/research.md`](docs/research.md)。

## 安装

**前置条件**：已安装 dsh CLI ≥ **0.1.0-rc.7**（`dsh --version`），并已建好目标 profile。NoLetMe 的浏览器包按 0.1.0-rc.7 的客户端包构建与验证；更早的 rc 版本未保证兼容。

**方式一 · npm 安装（推荐）** —— `dsh-noletme` 已发布到 npm，预构建安装，无需 `allowBuilds` 审批

```sh
dsh plugin --profile demo add dsh-noletme
```

安装后即可在网页端右上角看到面板。

**方式二 · 从 GitHub 直接安装**（`prepare` 脚本会在安装时自动构建 `lib/`）

```sh
dsh plugin --profile demo add github:Yuer6327/NoLetMe
```

> pnpm ≥ 10 默认拦截 git 依赖的 `prepare` 脚本。先把 pnpm 提示的包名写入该 profile 的 `pnpm-workspace.yaml`，再重新执行 `add`：

**方式三 · 本地目录安装**

```sh
cd /path/to/this/repo/..            # 进入 NoLetMe/ 所在目录的上级
dsh plugin --profile demo add ./NoLetMe
dsh web --profile demo              # 或直接：dsh --profile demo
```
>
> ```yaml
> allowBuilds:
>   dsh-noletme: true
> ```

**原理**：`cordis.patch.yml` 这层在组合里插入 `dsh-noletme` 行；`package.json` 的 `dsh.client` 块告诉网页壳加载浏览器包。

> **Windows 注意**：`cordis.patch.yml` 的行名用的是包名 `dsh-noletme`，因此只有把该包装入 profile 后悬浮层才生效。行名写成原始绝对路径会失败 —— ESM loader 拒绝 `D:\…` 入口名（`ERR_UNSUPPORTED_ESM_URL_SCHEME`）；Linux 下可用 `file://` URL 替代。

**本地开发**：

```sh
pnpm install && pnpm build
dsh web --patch 'D:/OneDrive/桌面/play/codes/dsh-plugin/NoLetMe/cordis.patch.yml'
```

## 使用

- 面板停靠于会话标题栏下方右上角（避开「Session log」下载按钮），浮在对话框上。
- **折叠**时是圆角胶囊（圆点 + "NoLetMe" + 当前模式），点击展开成卡片。**展开**后显示：实时状态条（流式/同步圆点、推理块数/字符数、可见回复）、轨迹模式徽章、各类占比条、原始指标（`we · let's · let me · I`）、关键词明细，以及犹豫压力健康提示。
- 胶囊↔卡片是同一表面的临界阻尼弹簧形变（可打断、锚定右 dock），`prefers-reduced-motion` 下降级为瞬时切换；开合状态会被记住。

### 数据口径、持久化与隐私

- **只统计推理，与证据一致**：关键词只对**推理块**计数，与 `analyze_trajectory_exports.py` 的范围完全一致。若模型几乎全部以可见文本输出、推理块很少，面板会显示**推理健康告警**（附原始 reasoning/text 计数），而不是凭空拿文本造数。
- **实时**：每个流式推理增量做增量折叠（每帧至多一次），从不整段重扫会话。
- **切换会话**：立即用本地缓存重绘新会话统计，再翻页载入**完整历史**（期间显示「同步中」指示）。
- **本地持久化**：每个会话的折叠计数存于 `localStorage`（`dsh-noletme.stats.<sessionId>`），重开会话不重新计数，只折叠新增消息。
- **健壮性**：压缩重写只重置计数一次；历史翻页有上限、切换离开即中止；存储失败被吞掉。
- 数据不离开你的浏览器。

## 构建

```sh
pnpm install      # devDependencies：tsdown、lightningcss、typescript、react types
pnpm typecheck    # 可选；tsc --noEmit
pnpm build        # tsdown → lib/index.js（node 半边）+ lib/client.js（浏览器包）
```

客户端依赖（`@deepseek-ai/dsh-client-*`）与 dsh CLI 内置的客户端包版本对齐，固定 `^0.1.0-rc.7`。

> ⚠️ 这些包在 npm 的 `latest` 标签是**过期**的 `0.0.1-rc.1`，真实最新版走 `next`（= `0.1.0-rc.7`）。升级依赖时请显式写 `^0.1.0-rc.7`，**不要用 `@latest`**。

> dsh CLI 升级后无需重装 profile：基底包（`dsh-base`、`dsh-web-app` 等）按"安装优先"从 CLI 自身解析，profile 里的行会自动跟到新版本。

浏览器包是 `window.__ModuleLoader__.load(...)` 闭包工厂产物（与 harness 自带的 `clientBundle` 预设同形）：平台模块走冻结模块表解析，其余内联，`*.module.css` 编译成哈希类名映射并自动注入样式。

## 架构

```
src/
├── index.ts            # Node（宿主）半边 —— 空操作，满足 Loader
└── client/
    ├── index.ts        # 浏览器包入口（apply/inject）
    ├── apply.ts        # 注册 shell.overlay 入口 + 统计 store
    ├── slots.ts        # inject-face + composed-props 契约
    ├── session-source.ts # 当前会话 ConversationSnapshot 可观察源
    ├── session-store.ts  # 统计 store：实时折叠、全历史翻页、持久化
    ├── accumulator.ts  # 每会话增量折叠 + 压缩 + 序列化
    ├── keywords.ts     # 有研究依据的关键词表
    ├── stats.ts        # 计数引擎（最长匹配遍历、按块缓存）
    ├── NoLetMePanel.tsx / .module.css
    └── locales.ts      # zh + en 词典
```

推理流以 `reasoning-delta` 分块到达，会话层累加进 `ConversationSnapshot.partial`（每动画帧至多发布一次），落定的轮次进 `snapshot.nodes`。统计 store 对两者都做**增量**折叠（按块身份缓存计数，新节点由 seq 高水位门控），发布现成的 `TrajectoryStats` —— 面板从不整段重算会话。`shell.overlay` 是布局的帧级纯增量席位，面板样式镜像 DetailsPanel。

## 许可证

[MIT](LICENSE)
