<img width="1710" height="1082" alt="" src="https://github.com/user-attachments/assets/ef968872-f49b-4183-9b20-9e9fe6846466" />


# NoLetMe · dsh 推理轨迹面板

[![npm version](https://img.shields.io/npm/v/dsh-noletme)](https://www.npmjs.com/package/dsh-noletme) [![Awesome dsh-plugin](https://camo.githubusercontent.com/d49867731e8dae50cfe6c3e25a3ef1d845d4e55aace9b1da5a31d47162f8e683/68747470733a2f2f617765736f6d652d6473682d706c7567696e2e636f6d2f62616467652e737667)](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)

NoLetMe 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）网页端插件，在会话页右侧边缘挂载一块**实时推理关键词统计面板**。

模型流式输出时，NoLetMe 只统计其**推理块（reasoning blocks）**中出现的特征词，据此反映当前推理风格：

| 分类 | 关键词 | 依据 |
|---|---|---|
| 🟢 高效 · 直接行动 | `We need…` `Let's…` `We should…` `We can…` `We will…`；首行 `Good.`/`Great.`/`Excellent.` | minimal 类高分轨迹 |
| 🟠 犹豫 · 第一人称试探 | `Let me…` `I think…` `I'm not sure…` `I wonder…` `I guess…` `maybe` `perhaps` | standard 类低分轨迹 |
| ⚪ 中性 · 复述任务 | `The user wants…` `The user asked…` `this task…` `the request…` | Standard 目录开场框架 |

**灰测**是另一层、不改 0813 词表：对**已加载的全部 reasoning 块**（含历史与当前流式 `partial`）做观测性判定，不是只看最近一轮。

**概要式怎么判**：非空行里，列表/标题行（`-` / `*` / `1.` / `#`）占比 ≥ 35% 记为概要形；短段落 alone 不够（0813 的 We-need 块也短），必须再叠 `I'm doing`。其它加分项：`I'm doing` / `I am doing`（含 `I'mdoing`）、开场即 `I'm doing`、脏 token（`Nameeee`、`antml:thinking`…）、泄漏的 `fp_v4pro_…`。纯 `Let me` / `We need` 减分。`score ≥ 5` 命中，`≥ 2` 疑似。面板同时给出完整风格数字：列表密度、块长 p50、TTR、词长——**未命中时也显示**，不当作家谱鉴定。

这仍是观测性指纹，不是路由实锤。面板 UI 只报数字与命中态，方法说明只写在本 README / `docs/research.md`。

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

**诚实边界**：原始矩阵原文警告：*"词法轨迹标签是观测性指纹，而非路由或身份标签。"* 词频只反映推理*风格*，不能判定后端、路由或 checkpoint；V4 Flash 会在分数不变时改变风格。灰测探针同样只报告社区观测到的特征组合，**不能**据此断言路由到了哪家模型。NoLetMe 是推理风格诊断工具，不是模型身份测试。

文献上的「LLM 风格指纹」分类器（例如 [Bitton & Bitton, arXiv:2503.01659](https://arxiv.org/abs/2503.01659) 的三分类器集成，或 Attestify 一类需训练语料的统计指纹）需要离线权重与校准集，**不适合塞进这个浏览器插件**。NoLetMe 只保留能本地、无模型地从 reasoning 算出的统计：列表密度、块长 p50、TTR、平均词长，作为灰测旁的完整数据，而不是把会话贴上 Claude/Gemini/GPT 标签。

完整事件报告见 [`docs/research.md`](docs/research.md)。

## 安装

**前置条件**：已安装 dsh CLI ≥ **0.1.0-rc.7**（`dsh --version`），并已建好目标 profile。NoLetMe 按 dsh **0.1.x** 的客户端契约构建：同时兼容 **rc.7、rc.8、0.1.1-rc.1、0.1.1-rc.2 以及之后的 0.1 更新**。更早的 rc 版本未保证兼容。

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
- **折叠**时是圆角胶囊（圆点 + "NoLetMe" + 模式；灰测命中/疑似时改显示该态）。**展开**后：状态条、灰测（命中态 + `I'm doing` / 列表密度 / p50 / TTR / 词长，以及脏 token、`fp_`）、轨迹模式、占比条、`we · let's · let me · I`、关键词明细、犹豫压力。方法说明不进面板。
- 胶囊↔卡片是同一表面的临界阻尼弹簧形变（可打断、锚定右 dock），`prefers-reduced-motion` 下降级为瞬时切换；开合状态会被记住。

### 数据口径、持久化与隐私

- **只统计推理，与证据一致**：关键词只对**推理块**计数。灰测与风格数字同样扫**已加载的全部 reasoning**（含历史与当前 `partial`），不看 text。若推理块缺失/极少，面板只报健康告警和原始计数，不拿文本凑数。0813 会话分类器保持原样。
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

客户端依赖（`@deepseek-ai/dsh-client-*`）声明为 `>=0.1.0-rc.7 <0.2.0 || >=0.1.1-rc.1 <0.2.0`，覆盖 rc.7、rc.8、0.1.1-rc.x 以及后续 0.1.x（semver 的 prerelease 比较器只匹配同 `[major,minor,patch]` 元组，`0.1.1-rc.1` 落在 `0.1.0` 的范围外，故需第二个分支）。dev 锁在 **0.1.1-rc.2**。浏览器包只 `require` rc.7∩rc.8∩0.1.1-rc.1∩0.1.1-rc.2 的平台种子模块（`react`、`cordis`、`dsh-client-ui-slots`、`dsh-client-ui-primitives`）；会话快照按结构子集读取（顶层 `nodes`/`partial`，必要时回退 `chat.legacy`），不把 runtime 打进冻结模块表。

> ⚠️ 这些包在 npm 的 `latest` 标签常常滞后（client 包 `latest` 仍可能是 `0.0.1-rc.1`，而 `@deepseek-ai/dsh` 的 `latest`/`next` 现为 0.1.1-rc.2）。升级依赖时请显式写上面的范围或具体 rc，**不要用 `@latest`**。

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
    ├── conversation.ts   # 宿主快照结构子集（nodes/partial 或 chat.legacy）
    ├── session-source.ts # 当前会话 ConversationView 可观察源
    ├── session-store.ts  # 统计 store：实时折叠、全历史翻页、持久化
    ├── accumulator.ts  # 每会话增量折叠 + 压缩 + 序列化
    ├── keywords.ts     # 有研究依据的 0813 关键词表
    ├── stats.ts        # 计数引擎（最长匹配遍历、按块缓存）
    ├── graytest.ts     # 本轮灰测探针（I'm doing / 概要形 / 脏 token / fp_）
    ├── NoLetMePanel.tsx / .module.css
    └── locales.ts      # zh + en 词典
```

推理流以 `reasoning-delta` 分块到达，会话层累加进 `partial`（每动画帧至多发布一次），落定的轮次进 `nodes`。rc.8 起宿主另有 `chat`/`views`，但顶层 `nodes`/`partial` 仍是兼容切片；若未来只剩 `chat.legacy`，`conversationViewOf` 会回退到那里。统计 store 对两者都做**增量**折叠（按块身份缓存计数，新节点由 seq 高水位门控），发布现成的 `TrajectoryStats` —— 面板从不整段重算会话。`shell.overlay` 是布局的帧级纯增量席位，面板样式镜像 DetailsPanel。

## 许可证

[MIT](LICENSE)
