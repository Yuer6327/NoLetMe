# NoLetMe — DSH 兼容性长期维护规范

- **生效日期**：2026-09-25
- **来源**：用户交接提示词（长期维护授权，基于 DSH STORE 兼容性上架契约）
- **维护范围**：仅限本文所述的 DSH 版本跟进；其他事项未经用户明确要求不要动手。

## 背景（必须理解）

- 本插件上架于 DSH STORE。商城每 8 小时（UTC 00:05 / 08:05 / 16:05）自动扫描本仓库默认分支的固定 Commit，不执行任何本地代码，也不需要作者回复任何 issue。
- 商城滚动窗口 = npm 上 `@deepseek-ai/dsh` 按发布时间最新的三个非弃用发行版。`package.json` 的 `dsh.compatibility.dshReleases` 矩阵必须对窗口内至少一个版本有精确 `compatible` 记录，否则条目被自动暂时下架（可自动恢复）；范围声明不能替代逐版本精确记录。
- 兼容性证据工具：仓库根 `verify-dsh-releases.mjs`（`pnpm dsh-releases check` / `pnpm dsh-releases probe <dsh版本>…`）。probe 对指定版本下载四个契约包并验证四项契约面：
  1. dsh-web-frontend 平台种子表（9 项，含插件必需的 7 项）；
  2. dsh-client-ui-layout 的 `shell.overlay` 仍为 `{kind:'list',scope:'root'}`；
  3. dsh-client-ui-chat 的 `chat.legacy` 切片仍含 `nodes`/`partial`；
  4. dsh-api-session-controller 的 `SessionFace = ISession & ObservableSnapshot<SessionSnapshot>` 且有 `loadOlder()`。
- 插件运行时兼容性按设计来自结构读取，不依赖依赖范围；因此静态探针通过即可作为 `compatible` 声明的依据，但静态探针不等于真实 Profile 实机验收。

## 例行流程（每次运行执行）

1. `git pull` 确保本地与 origin/main 一致。
2. `pnpm dsh-releases check`：
   - 退出码 0：窗口已全覆盖，本次结束，一句话报告，不做任何修改。
   - 退出码 1：npm registry 读取失败，失败关闭——不修改、不声明、不推送，报告错误后结束。
   - 退出码 2：取输出中的未声明版本列表，继续。
3. 未声明版本中若出现非 0.1.x 系列（如 0.2.0）：停止，不声明、不推送，报告「出现新版本线，需要人工评估」后结束（插件按 0.1.x 客户端契约构建，跨系列必须人工跟进）。
4. `pnpm dsh-releases probe <未声明版本…>`。任何一项探针失败：该版本保持未声明（unknown），本次不做任何提交与推送，报告失败详情后结束。宁可 unknown，绝不写入未经证实的 compatible。
5. 全部探针通过后修改文件：
   - `package.json`：每个新版本以 `"compatible"` 加入 `dsh.compatibility.dshReleases`（保留现有条目）；patch 版本号 +1；把六个 `@deepseek-ai` devDependencies（`dsh-brand`、`dsh-client-locale`、`dsh-client-store`、`dsh-client-ui-layout`、`dsh-client-ui-primitives`、`dsh-client-ui-slots`）的精确锁更新为本次已声明版本中最新的那个；其余字段不动。
   - `dsh-plugin.json`：仅把 `version` 改成与 `package.json` 一致。
   - 不修改 README（README 已注明矩阵以 package.json 为准；若出现新版本线，提醒用户人工更新 prose）。
6. `pnpm install`，然后依次 `pnpm typecheck`、`pnpm test`、`pnpm compat`、`pnpm build`。任何一步失败：`git checkout -- package.json dsh-plugin.json pnpm-lock.yaml` 撤销，报告失败输出，不推送。
7. 全部通过后提交：只 add `package.json dsh-plugin.json pnpm-lock.yaml`，提交信息第一行 `NoLetMe <新版本号>: follow dsh <版本列表>`，正文注明：四项静态契约探针逐版本通过、证据为静态发行物比对、未做真实 Profile 实机验收。推送到 origin/main；被拒时不强推、不覆盖远端，报告后结束。

## 硬性边界

- 探针不过绝不声明 compatible；失败关闭；绝不 force push；绝不写入或修改真实 `~/.dsh`；与任务无关的未提交改动一律不碰。
- `npm publish` 属对外发布且需要凭证：发现 npm 上的 `dsh-noletme` 版本落后于仓库版本时，只报告提醒用户发布，不自动执行。
- 不要在 DSH-Store 的任何 issue 下回复、确认或关闭；商城状态全自动流转。

## 当前基线（2026-09-25，本规范写入时记录）

- 插件 0.3.9；矩阵已声明 0.1.6-alpha.1 与 0.1.7 全线（alpha.1、alpha.2、rc.1、rc.2，其中 alpha.1/alpha.2/rc.2 为静态证据，0.1.6-alpha.1 与 0.1.7-rc.1 为历史实机验证）；dev lock 0.1.7-rc.2。
- 下一个待跟进版本预计为 0.1.7-rc.3 或 0.1.8。
