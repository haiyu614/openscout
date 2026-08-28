# M4 评测记录 — 审批与发布（Approval & Publish）

> 用户要求：按里程碑推进并留档测试记录。M1/M2/M3 已归档并推送；本轮为 M4。
> 评测日期：2026-08-28。评测方式：Core 纯逻辑单测（Mock Port）+ 适配器接线单测（vi.mock DSH）。
> 真机闭环验证待静态插件挂载能力就绪后补（与 M2/M3 同源，环境令牌限制，非代码问题）。

## M4 目标（来自 technical-plan.md §八）

把「已审阅（review）的贡献包」安全地发布成 GitHub 草稿 PR，并对所有危险操作施加
**版本绑定审批（fail-closed）**：

1. `ApprovalGate` — 版本绑定审批闸门；approve 绑定 approvedVersion，任何实质变更使其失效；
   用户不可达 → 'unavailable' → 拒绝。
2. `PublishEngine` — 发布执行：`approved → fork → branch → push → createPR(draft) → published`；
   任一步失败 → failed（半发布留痕，fail-closed）。
3. `ContribOrchestrator.approve` — review → approved（经 ApprovalGate，绑定版本）。
4. `adapter-dsh` 暴露 `openscout_approve` / `openscout_publish` 工具；`DshApprovalPort` 桥接宿主审批设施（缺省 fail-closed）。
5. `github-adapter` 写操作（fork/branch/push/PR/close/deleteBranch/getDefaultBranchSha）已于 M0 实现，M4 直接复用。

## 交付物

| 层 | 文件 | 职责 |
| --- | --- | --- |
| Core | `core/src/engines/contrib/approval-gate.ts` | `requestApproval`/`isApprovalValid`：版本绑定 + 不可用拒绝 |
| Core | `core/src/engines/contrib/publish-engine.ts` | `PublishEngine.publish`：fork→branch→push→PR→published，失败回写 failed |
| Core | `core/src/engines/contrib/orchestrator.ts` | 新增 `approve()`（review→approved，绑定版本） |
| Core | `core/src/models/pr-work-item.ts` | 新增 `reviewBundle` 字段（发布自承载审阅包） |
| Adapter | `adapter-dsh/src/approval.ts` | `DshApprovalPort`：桥接 `ctx.approval`，缺省 fail-closed |
| Adapter | `adapter-dsh/src/publishing-tools.ts` | `openscout_approve` / `openscout_publish` 工具 |
| Adapter | `adapter-dsh/src/index.ts` | 实例化 `DedupEngine`/`ContribOrchestrator`/`PublishEngine`，注册发布工具 |

> 架构边界澄清：Core 的 `PublishEngine` **不读文件系统**（Core 零 fs 依赖）。发布所需的文件字节
> 由宿主 Adapter 从 Agent 工作区读出，作为 `Commit[]` 经 `publish` 工具参数传入。这是端口/适配器
> 边界的必然结果，也是 M4 适配器 `openscout_publish` 接受 `files:[{path,content}]` 的原因。

## 架构不变量校验（关键）

- `packages/core` **零** DSH/Cordis 导入（grep 确认）；M4 Core 代码全在 `engines/contrib` + `models`，
  复用已有 Port（ApprovalPort/GitHubPort/StoragePort/ClockPort）。
- `PublishEngine` 仅依赖注入的 `storage`/`github`/`approval`；`ApprovalGate` 仅依赖 `ApprovalPort`。
- `github-adapter` 写操作保持真实 Octokit 实现，未因 M4 改动（仅复用）。

## 测试结果

```
pnpm build            → 通过（含 M4 Core + adapter）
pnpm test:coverage    → 99 个测试全过（M1 33 + M2 13 + M3 32 + M4 21），仓库覆盖率 90.19%
```

M4 新增 21 个测试：
- `approval-gate.test.ts`（5）：不可用→拒绝、拒绝→拒绝、版本一致→直接放行、版本漂移→重审批（绑定当前 version）。
- `publish-engine.test.ts`（6）：未 approved→拒绝且不调 GitHub 写、缺 ReviewBundle→拒绝、版本漂移→拒绝、
  完整发布成功（fork/branch/push/PR 全调用，状态 published、PR#7、draft=true）、fork 抛错→failed、createPR 抛错→failed。
- `orchestrator-approve.test.ts`（4）：review 经批准后 approved+绑定版本、不可用→拒绝、未配 ApprovalPort→拒绝、非 review→拒绝。
- `adapter-dsh/tests/publishing.test.ts`（6）：`DshApprovalPort` 缺设施 fail-closed / 委托；发布工具注册与委托路由（含 commits 构造、缺 files 退空数组）。

详细产物见 `docs/test-reports/m4-{build,coverage,tests,contract}.txt`。

## 覆盖情况

- `core/src/engines/contrib` 覆盖率 96.79%（分支 74.81%）；`approval-gate.ts` 93.33%、`publish-engine.ts` 92.3%、`pr-workflow-engine.ts` 100%。
- 仓库整体覆盖率由 M3 的 97.79% 降至 90.19%，原因是 M4 新增的 adapter 胶水层
  （`approval.ts`/`publishing-tools.ts`）在单测中仅覆盖路由部分，未跑真实 DSH 宿主——与 M2 一致
  （adapter 胶水在宿主运行态验证）。Core 引擎覆盖率仍维持 ≥92%。

## 回归确认

- M1/M2/M3 单测无回归（93→99 全过）。
- Core 零框架依赖不变量维持。

## 遗留项

- [ ] 真机闭环（fork→push→草稿 PR）待静态插件挂载能力 + 有效 GitHub token 后跑通（`adapter-dsh` 已注册
  `openscout_publish`，届时由 adapter-agent 提供文件字节）。
- [ ] 宿主审批设施 `ctx.approval` 的真实实现（当前 DSH shim 声明为可选，缺省 fail-closed；真机需挂载具体审批 UI/waterfall）。
- [ ] `ContribOrchestrator.generate`（M3 搜索生成闭环）在宿主侧经 adapter-agent 注入 `AgentPort` 后真机跑通。
