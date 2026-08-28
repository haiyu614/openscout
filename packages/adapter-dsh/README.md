# @openscout/adapter-dsh

OpenScout 的 **DSH（DeepSeek Harness）适配器**。把 Core 引擎（`@openscout/core`）接入
DSH 宿主，形成「GitHub 原始结果 → Core 可解释评分/可行性 → 模型可见工具」的闭环。

## 职责边界（端口/适配器六边形）

本包是**唯一**感知 DSH 的层。Core 完全不知道 DSH 的存在；换宿主（Codex / OpenCode /
CLI / MCP）只改对应的 `adapter-*`，Core 一行不动。

| Core 接口 | DSH 实现 |
| --- | --- |
| `StoragePort` | `DshStorage` → `ctx.storageDomain.open(spec)` 的 `Domain`/`KvTable` |
| `CredentialPort` | `DshCredentialPort` → `ctx.credentials.resolve('GITHUB_TOKEN')` |
| `GitHubPort` | 复用 `@openscout/github-adapter` 的 `OctokitGitHubAdapter`（逐调用经 CredentialPort 取 token） |

模型可见工具（经 `ctx.tools.register` 注册）：
- `search_repos` — 自然语言搜仓库，返回可解释评分/理由/担忧
- `search_issues` — 指定仓库搜可贡献 Issue，返回可贡献性评估/理由/阻塞项

## 编译与测试

本包在 OpenScout monorepo 内可独立 `tsc --build` / vitest，不依赖未发布的 harness 源码：
DSH 运行时类型以 `src/types/dsh-shims.d.ts` 的 ambient module 声明提供（编译期垫片，运行时由宿主真实模块替代）。

```sh
pnpm build                  # 全量构建（含本包）
pnpm test:coverage         # 全量测试 + 覆盖率（本包 13 个测试）
```

## 挂载方式

### A. 持久挂载（部署态）

在宿主 `cordis.yml` 的插件行中加入编译产物：

```yaml
plugins:
  - id: openscout-dsh
    path: packages/adapter-dsh/dist/index.js   # 或 source 入口
    config:
      githubTokenRef: GITHUB_TOKEN
```

插件导出 `name='openscout-dsh'`、`inject=['storageDomain','credentials','tools']`、`apply`。
其 `apply` 打开 `openscout` 持久化域、构造 `SearchEngine`、注册两个搜索工具，并在卸载时
按序释放（先卸工具，再 `domain.close()`）。

### B. 运行态动态插件（调试/验证）

动态插件沙箱禁止 `require`（无法加载本包已编译源码），因此运行态验证用等价手写逻辑
证明同样的 DSH 服务契约（`harness.defineTool` + `ctx.tools.register` +
`ctx.storageDomain.open`）。详见 `docs/m2-evaluation.md`。

## 已知限制

- 动态插件沙箱拦截网络与外源模块，故实时 GitHub 搜索只能在**持久挂载 + 有效 token** 下真机跑通。
- DSH 域/表名须匹配 `UNIT_NAME_RE`（仅 `[a-z0-9_]`），故 `TABLE` 统一使用下划线命名。
