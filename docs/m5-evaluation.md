# M5 评测记录 — 定时任务（持续扫描）

> 评测日期：2026-08-28。用户指令：继续 M5（定时任务），交付后由用户自行 push（本次不推送远程）。
> 范围：M5 全部子任务 — SchedulerEngine（cron 解析+触发）、TaskEngine（CRUD+配额+水位）、adapter-scheduler（Cordis timer→SchedulerPort）、plugin-tools（任务管理工具）。

## 交付物

### Core 纯逻辑（pkg: `@openscout/core`，零框架依赖，仅 zod）

| 文件 | 职责 |
| --- | --- |
| `engines/cron.ts` | `parseCron` / `parseEvery` / `nextOccurrence`：5 字段 cron + `@every <dur>` 解析；时区感知（`Intl`）计算下一次触发；纯函数，无宿主依赖 |
| `engines/task.ts` | `TaskEngine`：任务 CRUD、状态机（draft→active↔paused→stopped、error 标记）、日/周配额窗口累加与检查、扫描水位读写 |
| `engines/scheduler.ts` | `SchedulerEngine`：基于注入 `SchedulerPort` 排程；`reconcile` 对账；触发后 fail-safe 重新排程（runHandler 抛错标记 error 但不中断循环）；`activate/pause/stop` 状态联动 |
| `engines/scan.ts` | `ScanOrchestrator`：单次运行编排（搜索 Issue → 去重 → 生成贡献包），受 `maxIssuesPerRun` / `maxPRsPerRun` / `maxConcurrent` / 日周配额约束；写 `TaskRunRecord` + 更新水位 |

### DSH 适配层（pkg: `adapter-dsh`，编译期依赖 `@deepseek-ai/*` shim）

| 文件 | 职责 |
| --- | --- |
| `plugin-scheduler.ts` | `buildScheduler`：用 Cordis `ctx.effect` + `setTimeout` 实现 `SchedulerPort`（插件卸载即取消）；`runHandler` 组装 `ScanOrchestrator`（依赖真实 `GitHubPort` + `AgentPort` + `ApprovalPort`） |
| `task-tools.ts` | `registerTaskTools`：`openscout_create_task` / `openscout_list_tasks` / `openscout_activate_task` / `openscout_pause_task` / `openscout_delete_task` 五个模型可见工具 |
| `index.ts` | 在 `apply` 的 effect 内 `buildScheduler(...)` 并 `start()`；注册任务工具；清理时先卸工具、停调度、关域（可逆转） |

## 设计要点与不变式

- **端口隔离**：`SchedulerEngine` 不持有任何定时器实现，只依赖 `SchedulerPort`（宿主注入）；Core 逻辑对 DSH/Codex 无感知，换宿主仅替换适配器。
- **fail-closed**：
  - `SchedulerEngine.onFire` 中 runHandler 抛错 → 任务标记 `error` 但**仍重新排程**（cron 持续运行）；状态为 `paused`/`stopped` 时不再排程（显式关闭才停）。
  - `ScanOrchestrator` 受 `maxPRsPerRun` / 日周配额硬上限约束，超限即停止生成。
- **幂等**：`TaskRunRecord` 全程可重入；配额窗口用 get+put 累加（兼容 `InMemoryStorage.update` 的「缺键即抛」契约）。
- **时区正确**：`nextOccurrence('0 9 * * *', …, 'Asia/Shanghai')` 正确落为 `01:00 UTC`（09:00 CST）。`@every 30m` 从 `:00:05Z` 得到 `:30:05Z`。
- **Core 零 DSH 依赖**：`packages/core` 仍只 import `./ports/*` / `./models/*` / `zod`；M5 全部 DSH 耦合在 `adapter-dsh`。

## 单测（Mock Port，99 → 125，+26）

| 用例文件 | 覆盖 | 数量 |
| --- | --- | --- |
| `cron.test.ts` | 5 字段/步长/越界/@every/nextOccurrence 时区 | 9 |
| `task.test.ts` | create/list/状态流转/配额上限与放行/水位 | 7 |
| `scheduler.test.ts` | activate 排程+fire、fire 后重排程、抛错不中断、pause 取消、reconcile 仅 active | 5 |
| `scan.test.ts` | 全流程统计、去重跳过、maxPRsPerRun 限制、日配额用尽跳过、水位更新 | 5 |

全量：`vitest` **125/125 通过**（含 M0–M4 无回归）。`tsc --build` 全包通过。

## 真机验证说明

- Core 逻辑经 Mock Port 完整覆盖（与 M1–M4 一致，不直连 GitHub）。
- adapter-dsh 的 `plugin-scheduler` / `task-tools` 仅在 DSH 宿主内编译（经 `dsh-shims.d.ts`），本仓库无法跑真机 Cordis 加载（host 进程缺 `@deepseek-ai/*` 运行时，详见 `docs/real-loop-evaluation.md`）。其编译期契约与 `M2` 既有 `search_repos`/`openscout_publish` 工具一致，已通过 `tsc --build` 校验。
- 如需真机跑通「定时任务触发真实扫描」，需先完成持久插件挂载（跨仓库，待定），或复用 `scripts/real-loop.mts` 思路做一次性驱动验证（不在本里程碑范围）。

## 提交状态

- 已 `git commit`（本地），**未推送**（用户将自行 push）。
- 改动：`packages/core/src/engines/{cron,task,scheduler,scan}.ts`、`packages/core/src/index.ts`（导出）、`packages/core/tests/{cron,task,scheduler,scan}.test.ts`、`packages/adapter-dsh/src/{plugin-scheduler,task-tools}.ts` + `index.ts` 接线、文档归档。
