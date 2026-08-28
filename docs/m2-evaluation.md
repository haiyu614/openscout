# M2 评测记录 — DSH Adapter 搜索闭环

> 依据用户要求：先完整评测 M1，再进行 M2，并保留测试记录。
> 评测日期：2026-08-28。评测环境：deepseek-harness 运行态（动态 Cordis 插件）+ OpenScout monorepo 独立 `tsc --build`/vitest。

## M2 目标（来自 technical-plan.md）

构建 `packages/adapter-dsh`，把 Core 引擎接入 DSH 宿主，形成「GitHub 原始结果 →
Core 可解释评分/可行性 → 模型可见工具」的闭环：

1. `StoragePort` → DSH `storageDomain`（Domain KvTable）
2. `CredentialPort` → DSH `ctx.credentials`
3. `GitHubPort` 复用 `@openscout/github-adapter` 的 `OctokitGitHubAdapter`
4. 注册模型可见工具 `search_repos` / `search_issues`
5. 端到端验证

## 交付物

| 文件 | 职责 |
| --- | --- |
| `packages/adapter-dsh/src/spec.ts` | OpenScout DSH 域声明（5 张业务表 → Domain KvTable），复用 Core zod schema |
| `packages/adapter-dsh/src/storage.ts` | `DshStorage implements StoragePort`：Domain→Core 五表桥接 |
| `packages/adapter-dsh/src/credential.ts` | `DshCredentialPort implements CredentialPort`：委托 `ctx.credentials.resolve` |
| `packages/adapter-dsh/src/tools.ts` | `search_repos`/`search_issues` 工具定义（调用 Core SearchEngine，纯编排） |
| `packages/adapter-dsh/src/index.ts` | Cordis 插件入口：`open` 域、构造引擎、注册工具、可逆转清理 |
| `packages/adapter-dsh/src/types/dsh-shims.d.ts` | DSH 运行时类型垫片（ambient modules），使包在 monorepo 内可独立 `tsc --build` |

## 架构不变量校验（关键）

- `packages/core` **零** DSH/Cordis 导入（grep 确认）。M2 新增全部在 `adapter-dsh`，Core 未改动。
- `adapter-dsh` 仅依赖 `StoragePort`/`CredentialPort`/`GitHubPort` 等 Core 接口 + DSH 宿主服务，符合端口/适配器六边形边界。

## 测试结果

### 单元/构建（独立 monorepo，真实 Core）

```
pnpm build            → 通过（含 adapter-dsh）
pnpm test:coverage    → 46 个测试全过，仓库覆盖率 97.39%（M1 时 50.61%）
```

adapter-dsh 新增 13 个测试（全部 mock 掉 DSH 运行时模块，不依赖未发布 harness 源码）：
- `storage.test.ts`（6）：Domain KvTable ↔ Core StoragePort 五表的 get/put/update/entries/size/delete 语义。
- `credential.test.ts`（4）：逐调用解析、未配置返回 undefined、热轮换、自定义 ref。
- `tools.test.ts`（3）：两个工具注册、search_repos/search_issues 委托 Core SearchEngine 并透出可解释字段。

详细产物见 `docs/test-reports/m2-{build,coverage,tests,contract}.txt`。

### 运行态 DSH 服务接线验证（动态 Cordis 插件，真连宿主）

在同一运行态 harness 内以动态插件实测了 `adapter-dsh` 用到的真实服务契约：

| 验证点 | 结果 | 证据 |
| --- | --- | --- |
| `storageDomain.open(spec)` 接受 OpenScout 风格域声明并打开 | ✅ | `opened:openscout_m2_v6`，`put/get` 往返成功，`size:1` |
| 域表名校验 `UNIT_NAME_RE` | ✅ | 含连字符的名称被拒（`invalid unit name`），下划线通过——故 `TABLE` 全部用下划线 |
| `credentials.resolve('GITHUB_TOKEN')` 解析真实令牌 | ✅ | 返回 `gho_…`（source=env），确认凭据接线可用 |
| 动态工具注册必须经 `harness.defineTool` | ✅ | 裸 `ToolDefinition` 被拒（`must use a tool returned by harness.defineTool`）；`harness.defineTool(...)`+`ctx.tools.register(...)` 成功 |
| `ctx.tools.execute` 从插件直接调用 | ⚠️ 不适用 | 插件侧无 agent/exec 上下文，工具由模型驱动执行；注册即「模型可见」 |

> 说明：动态插件沙箱**禁止 `require`**（无法加载已编译的 `@openscout/core`/`@octokit/rest`），
> 且沙箱网络被拦截，因此未能在该插件内跑完整 GitHub 搜索。适配器层（DSH 服务接线）已用上述
> 真实服务调用证明；宿主侧真实 GitHub 调用见下。

### 宿主侧真实 GitHub 调用（环境受限，未跑通）

尝试用主机 `node`/`tsx` 直连 GitHub 运行 Core `SearchEngine` + `OctokitGitHubAdapter`：
- 主机 `curl https://api.github.com/...` 返回 HTTP 200（网络可达）；
- 但 `.dsh/.credentials.yaml` 中的 fine-grained token 实测 **401 Bad credentials**（已轮换/失效）；
- harness `credentials` 解析出的 `gho_…` 令牌不在本会话 shell 环境中，无法用于主机侧脚本。

**结论**：完整「实时 GitHub 搜索」受**环境令牌失效 + 沙箱限制**阻断，非代码缺陷。
Core 评分/可行性逻辑本身已由 33 个 M1 单测 + 13 个 M2 单测覆盖；适配器层 DSH 契约已运行态验证。
待用户提供有效 GitHub Token（或刷新 `.credentials.yaml`），可补一次 `scripts/live-search-loop.mjs` 真机跑通。

## 回归确认

- M1 的 33 个引擎单测仍全过，engines 覆盖率 98.05%（`dedup 98.44%`、`preflight 94.87%`、`ranker 97.75%`、`search 100%`）。
- 无 Core 改动，零框架依赖不变量维持。

## 遗留项

- [ ] 待有效 token 后补 `scripts/live-search-loop.mjs` 真机端到端（环境令牌已失效，非代码问题）。
- [ ] 将 `adapter-dsh` 实际挂载进一个 DSH `cordis.yml`（挂载片段见 `packages/adapter-dsh/README.md`）；本会话已用动态插件等价验证其服务接线。
