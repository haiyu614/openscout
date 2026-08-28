# M3 评测记录 — 贡献包生成（Contribution Pack）

> 依据用户要求：先完整评测 M1、再做 M2（已归档），随后继续 M3，保留测试记录。
> 评测日期：2026-08-28。评测方式：Core 纯逻辑单测（Mock Port）；真机闭环待 M2 所述的静态插件挂载支持后补。

## M3 目标（来自 technical-plan.md §七）

构建「针对一个合格 Issue 生成可提交贡献包」的核心能力，纯逻辑、可独立测试：

1. `ReviewBundleBuilder` — diff + 摘要 + PR 文案（可审阅贡献包）
2. `PRWorkflowEngine` — 10 状态流转状态机（fail-closed）
3. `ContribOrchestrator` — 工作流编排：去重 → Agent 代码工作 → ReviewBundle → 状态流转
4. 复用 `@openscout/github-adapter` 的 `OctokitGitHubAdapter`（M4 发布阶段使用）、`DedupEngine`、`StoragePort`

> 计划原文 M3 还列了 `adapter-agent`（ctx.subagents→AgentPort）、`adapter-fs/shell`（工作区管理）、
> Agent Preset/Skill 配置。这些属于**宿主适配层**。本轮聚焦 Core 纯逻辑三件套（编排/状态机/贡献包），
> 宿主适配器随 M4（审批/发布）的静态插件挂载一并落地——与 M2「先 Core 纯逻辑 + 适配器已验证接线」的
> 一致节奏。真机闭环验证同样待静态插件能力就绪后做。

## 交付物（全部在 packages/core，零 DSH 依赖）

| 文件 | 职责 |
| --- | --- |
| `core/src/engines/contrib/review-bundle-builder.ts` | `buildReviewBundle(ctx, agentResult)`：规范 PR 标题/正文/提交信息、提取风险、汇总验证 |
| `core/src/engines/contrib/pr-workflow-engine.ts` | `transition/isTerminal/canReset`：10 状态机，legal 映射表外一律 fail-closed |
| `core/src/engines/contrib/orchestrator.ts` | `ContribOrchestrator.generate/reset/checkDuplication`：去重→candidate→generating→review；Agent 委托；ReviewBundle 构建 |
| `core/src/index.ts` | 导出 M3 三引擎及类型 |

状态机覆盖的 10 状态（与 `PRWorkItemStatus` 模型一致）：
`candidate → generating → review → approved → publishing → published → revising/closed`，
失败/弃用 `failed/discarded`，终态 `reset` 收敛到 `candidate`。

## 架构不变量校验（关键）

- `packages/core` **零** DSH/Cordis 导入（grep 确认）。M3 全部代码在 Core 内，复用已有 Port/模型。
- Orchestrator 仅依赖注入的 `StoragePort` / `DedupEngine` / `AgentPort` / `ClockPort`，符合端口/适配器边界。

## 测试结果

```
pnpm build            → 通过（含 M3 三个引擎）
pnpm test:coverage    → 78 个测试全过（M1 33 + M2 13 + M3 32），仓库覆盖率 97.79%
```

M3 新增 32 个测试：
- `review-bundle-builder.test.ts`（8）：PR 文案/提交信息/Issue 引用/验证汇总/风险提取/无 Issue 场景/schema 校验。
- `pr-workflow-engine.test.ts`（17）：全部合法流转 + **fail-closed 非法流转拒绝**（candidate 不能直接 approved、published 不能再 generate、终态不可 reset 等）+ isTerminal/canReset。
- `orchestrator.test.ts`（7）：去重命中拦截、完整生成到 review、Agent 失败转 failed、Agent 入参校验、手动贡献意图去重、reset 收敛。

详细产物见 `docs/test-reports/m3-{build,coverage,tests,contract}.txt`。

## 覆盖情况

- `core/src/engines/contrib` 覆盖率 **98.82%**（分支 73%）；`orchestrator.ts` 99.22%、`pr-workflow-engine.ts` 100%、`review-bundle-builder.ts` 97.5%。
- 仅 `orchestrator.ts` 第 119 行（agent 失败后 `toFail.ok` 分支的兜底 workItem）与 builder 89-90 行（缺省回填）未覆盖，属防御性分支。

## 回归确认

- M1/M2 单测仍全过，engines 覆盖率维持 ≥98%。
- Core 零框架依赖不变量维持。

## 遗留项

- [ ] 真机闭环验证（去重→Agent→ReviewBundle→发布）：待静态插件挂载能力就绪后，由 `adapter-dsh` + 新增 adapter-agent/fs/shell 在真机跑通（与 M2 真机验证同源，环境令牌限制，非代码问题）。
- [ ] 宿主适配器 `adapter-agent` / `adapter-fs` / `adapter-shell`（M4 阶段随审批/发布一起落地）。
