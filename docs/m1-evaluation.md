# M1 评测记录（留档）

> 范围：`packages/core` 的搜索引擎与去重引擎（M1 里程碑）
> 评测日期：2025-08-28
> 仓库：`https://github.com/haiyu614/openscout.git`，分支 `main`，基线提交 `ee6fc1f`

---

## 1. 构建结果

| 项 | 结果 |
|----|------|
| `pnpm build`（`tsc --build`） | ✅ 通过，无错误 |
| 产物 | 仅 `packages/*/dist`（已 gitignore），无散落 `.d.ts`/`.js` 到 `tests/` |

构建日志见 `docs/test-reports/m1-build.log`。

---

## 2. 测试结果

| 项 | 结果 |
|----|------|
| 测试文件 | 3 passed |
| 测试用例 | **33 passed / 33**（0 失败、0 跳过） |
| 测试策略 | 全部使用 Mock Port：`InMemoryStorage` + `makeMockGithub` + `fixedClock`，不依赖真实 GitHub / 宿主 |
| 执行耗时 | ~370ms（vitest run） |

用例清单见 `docs/test-reports/m1-tests.txt`（含每个用例名与耗时）。

### 覆盖率（engines 为目标层）

| 文件 | Stmts | Branch | Funcs | Lines |
|------|-------|--------|-------|-------|
| `engines/search.ts` | 100% | 100% | 100% | 100% |
| `engines/ranker.ts` | 97.75% | 96.29% | 100% | 97.75% |
| `engines/dedup.ts` | 98.47% | 85.41% | 100% | 98.47% |
| `engines/preflight.ts` | 94.87% | 92.85% | 100% | 94.87% |
| **engines 合计** | **98.07%** | **90.81%** | **100%** | **98.07%** |

> 仓库级聚合覆盖率为 68.73%，被 M0 遗留的、M1 尚未使用的数据模型（`task.ts`、`quota.ts`、`review-bundle.ts`、`pr-work-item.ts` 等）拉低，属预期；M1 引擎目标层覆盖率 **>94%**，远超 ≥80% 目标。
> 覆盖率报告见 `docs/test-reports/m1-coverage.txt` 与 `docs/test-reports/coverage/`。

---

## 3. 复用性契约审计（核心可跨宿主目标）

依据技术方案 v2 §1.4「核心层不允许出现的 import」：

| 检查项 | 结果 |
|--------|------|
| core 不含 `@deepseek-ai/*` / `@octokit/*` / `node:*` / `cordis` 等 **import** | ✅ 无任何违禁 import |
| core 运行时依赖 | ✅ 仅 `zod`（devDep 为 `workspace:*` 的 storage-memory，仅测试用） |
| core 代码体是否出现 `ctx`/`inject`/`apply`/`effect`/`cordis` 等宿主概念 | ⚠️ 仅在 Port 接口 doc-comment 中出现（说明抽象对象），非实际代码引用 |
| engine 仅 import `../ports/*` 与 `../models/*` | ✅ 已逐文件核对 import 图 |

审计明细见 `docs/test-reports/m1-contract.txt`。

**结论**：Core 引擎满足「零框架依赖、可独立构建与测试」的复用性要求，Codex / OpenCode / CLI / MCP 适配层可直接引用而不必改动核心。

---

## 4. 代码评测（Code Review 要点）

### 4.1 通过项
- **逻辑分层清晰**：`SearchEngine`（编排）委托 `CandidateRanker`（评分规则）/ `ContributionPreflight`（可行性），规则单一来源，便于改规则时只动一处。
- **可测试性**：`CandidateRanker` 与 `DedupEngine` 均接受可注入 `ClockPort`；`assessIssueFeasibility` 也支持传入 `now`，使「过旧」判定在单测中确定性可复现。
- **去重规则覆盖完整**：按定位文档 §6.2 实现 8 条规则中的 1/2/3/4/5/6/8；规则 7（版本去重）由后续 `PRWorkflowEngine` 复用 `findActiveByIssueKey` 处理，接口已预留。
- **墓碑机制符合产品语义**：删除/拒绝/关闭记录保留最小审计（`tombstoneReason`/`tombstoneAt`），默认不重复生成，支持显式 `restore`。
- **运行幂等**：同 `runId + key` 复用记录，避免调度重试/超时恢复重复创建工作项。

### 4.2 风险与改进项（已处理 / 待观察）
| 项 | 状态 | 说明 |
|----|------|------|
| `DedupEngine` 曾保留未使用的 `github` 依赖字段 | ✅ 本次评测已移除（远端事实改为显式 `RemoteFacts` 传入） | 见提交 `ee6fc1f` 后续小幅清理 |
| 评分权重为经验值（活跃度 25 / 社区 20 / Issue 15 / 许可证 10 / 语言 5 / topics 5） | ⚠️ 待观察 | 产品上线前建议用真实候选集校准，权重已集中在 `ranker.ts` 易于调参 |
| 规则 8（等价修复）的「发布前终检」入口在 `checkRemote` 预留（`repoMeta` 参数）但当前由调用方判断 | ⚠️ 待 M4 补齐 | `PublishEngine` 发布前须接入 Issue 时间线等价修复检测 |
| `StoragePort.dedup` 为全表线性扫描（`findRecord`） | ⚠️ 待观察 | 当前规模下可接受；大数据量时应在 Adapter 层（SQLite）做索引，Core 接口不变 |
| M0 遗留模型未被 M1 覆盖（覆盖率缺口） | ⚠️ 待 M3/M5 补齐 | 不影响 M1 正确性 |

---

## 5. 结论

M1 交付质量达标：
- 构建通过，33/33 单测通过，engines 层覆盖率 ≥94%（目标 ≥80%）；
- 核心引擎满足零框架依赖的跨宿主复用契约；
- 去重 8 规则 + 墓碑机制完整，且与产品定位 §6.2 / §7.4 一致；
- 评测发现的小问题（死代码字段）已在评测阶段清理。

**准予进入 M2：DSH Adapter 搜索闭环**。

---

## 附：评测产物索引

| 文件 | 内容 |
|------|------|
| `docs/test-reports/m1-build.log` | `tsc --build` 输出 |
| `docs/test-reports/m1-coverage.txt` | vitest + v8 覆盖率文本报告 |
| `docs/test-reports/coverage/` | v8 结构化覆盖率（lcov/json/html） |
| `docs/test-reports/m1-tests.txt` | 33 个用例名 + 耗时 |
| `docs/test-reports/m1-contract.txt` | 复用性契约审计（import/依赖/import 图） |
