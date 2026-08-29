# M6 评测记录 — 多轮协作 + 去重完善

> 评测日期：2026-08-28。用户指令：继续 M6（多轮协作 + 去重完善），交付后由用户自行 commit/push（本次不 commit）。

## 交付物

### Core 纯逻辑（pkg: `@openscout/core`，零框架依赖，仅 zod）

| 文件 | 变更 |
| --- | --- |
| `engines/contrib/pr-workflow-engine.ts` | 状态机扩展：`review:revise→revising`、`approved:revise→revising`、`approved:discard`/`approved:reject`、`revising:submit-for-review→review`、`revising:fail→failed`；新增 `canRevise(status)` 与 `nextVersion(currentVersion)` 辅助 |
| `engines/contrib/orchestrator.ts` | `revise(id, instruction?)`：多轮修改编排（重新打开→委托 Agent→构建新版本审阅包 `version=currentVersion+1`→回到 review）；`listWorkItems()` 列出全部工作项 |
| `engines/dedup.ts` | `recordPublication(key, prNumber)` / `publishedPRNumbersFor(key)`：跨轮/跨任务已发布 PR 跟踪（规则 4 增强）；墓碑/跨任务/意图去重逻辑保持并强化 |
| `models/dedup.ts` | `DedupRecord` 增加 `publishedPRNumber?: number` 字段 |
| `engines/contrib/publish-engine.ts` | `PublishEngineDeps` 增加可选 `dedup` + `issueKey`；发布成功后调用 `dedup.recordPublication`（防重发） |
| `index.ts` | 导出 `canRevise` / `nextVersion` |

### DSH 适配层（pkg: `adapter-dsh`，编译期 shim）

| 文件 | 职责 |
| --- | --- |
| `workitem-tools.ts` | `registerWorkItemTools`：`openscout_revise`（多轮修改，版本递增）、`openscout_list_workitems`、`openscout_reset_workitem` |
| `index.ts` | 接线：注册工作项工具 + 可逆转清理 |

## 设计要点与不变式

- **多轮协作闭环**：`review/approved/published/revising` 均可 `revise` 重新打开；每轮 `currentVersion +1`，`ReviewBundle.version` 同步递增；改完 `submit-for-review` 回 `review`。Agent 失败回 `failed`（新增 `revising:fail→failed`），版本不递增。
- **fail-closed**：
  - 非多轮状态（candidate/failed/discarded/closed）`revise` 被拒，返回 `agent-failed` + 原因。
  - 缺失/非法流转一律经 `transition` 拒绝，绝不静默放行（新增 `revising:fail` 修复了原 `revising` 失败无落点的问题）。
- **去重完善**：
  - 规则 4 增强：发布成功后把远端 PR 号写入去重注册表，后续同 Issue 扫描（含其他任务）经 `publishedPRNumbersFor` 识别，避免重发。
  - 规则 2（跨任务主键）/规则 5（意图）/规则 6（墓碑）保持，并补充 `restore` 后恢复可重新生成的端到端用例。
- **Core 零 DSH 依赖**：M6 所有 DSH 耦合仅在 `adapter-dsh/workitem-tools.ts`；`packages/core` 仍只 import `./ports/*` / `./models/*` / `zod`。

## 单测（Mock Port，125 → 140，+15）

| 用例 | 覆盖 |
| --- | --- |
| 状态机扩展（5） | canRevise 取值、review/approved/revising→revising、revising→review、nextVersion、非法流转拒绝 |
| 多轮修改 revise（5） | review 状态版本递增回 review、published 状态重新打开迭代、非多轮状态拒绝、Agent 失败回 failed 版本不递增、listWorkItems |
| 去重完善（5） | recordPublication 可见、跨任务意图去重、墓碑+restore、跨任务主键标记来源 |

全量：`vitest` **140/140 通过**（含 M0–M5 无回归）。`tsc --build` 全包通过。

## 提交状态

- 按用户要求：**未 commit / 未 push**（用户将自行执行）。
- 改动：`packages/core/src/engines/contrib/{pr-workflow-engine,orchestrator,publish-engine}.ts`、`packages/core/src/engines/dedup.ts`、`packages/core/src/models/dedup.ts`、`packages/core/src/index.ts`、`packages/core/tests/m6-multiround.test.ts`、`packages/adapter-dsh/src/workitem-tools.ts` + `index.ts` 接线、文档归档。
