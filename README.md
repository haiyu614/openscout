# OpenScout

持续开源发现与贡献助手 — 基于 Agent 的 GitHub Issue 发现、代码贡献和 PR 管理工作流引擎。

## 项目定位

OpenScout 是一个依附通用 Agent 运行的持续开源发现与贡献助手：根据用户的自然语言需求，在 GitHub 上寻找合适的开源项目和可解决的 Issue；用户关注仓库后，可创建定时任务，按指定频率和数量持续扫描 Issue、生成本地 PR 草案，并通过去重机制避免重复劳动；每个 PR 草案都支持多轮对话修改，只有在用户明确批准后才执行 fork、push 和创建远端 PR。

## 架构：Port/Adapter 六面体

核心工作流代码（`packages/core`）是纯 TypeScript 库，**零框架依赖**，通过 Port 接口与外部世界交互。任何宿主（DSH、Codex、OpenCode、CLI）只需实现 Adapter 层即可复用全部核心逻辑。

```
┌────────────────────────────────────────────┐
│         Host Adapters (DSH/Codex/CLI)      │
├────────────────────────────────────────────┤
│         Port Interfaces (9 个契约)          │
├────────────────────────────────────────────┤
│         Core Engines (纯业务逻辑)           │
├────────────────────────────────────────────┤
│    Infrastructure Adapters (Octokit/FS)    │
└────────────────────────────────────────────┘
```

### Port 接口

| Port | 职责 |
|------|------|
| `StoragePort` | 持久化（CRUD + 原子更新） |
| `GitHubPort` | GitHub API 交互 |
| `AgentPort` | 委托 Agent 做代码工作 |
| `ApprovalPort` | 用户审批 |
| `SchedulerPort` | 定时调度 |
| `FileSystemPort` | 文件操作 |
| `ShellPort` | 命令执行 |
| `CredentialPort` | 凭据管理 |
| `NotifyPort` | 用户通知 |
| `ClockPort` | 时间（可测试） |

## 包结构

```
packages/
├── core/              # ★ 核心引擎（零框架依赖，只依赖 zod）
│   └── src/
│       ├── ports/     # Port 接口定义
│       ├── models/    # 数据模型（zod schema）
│       └── engines/   # 业务逻辑引擎
├── github-adapter/    # GitHub API 实现（Octokit）
├── storage-memory/    # 内存存储（测试用）
└── adapter-dsh/       # DSH 宿主适配（未来）
```

## Quick Start

```bash
# 安装依赖
pnpm install

# 类型检查
pnpm typecheck

# 运行测试
pnpm test

# 构建
pnpm build
```

## 核心价值

- **找得准** — 结合仓库活跃度、技术栈、许可证、Issue 状态进行可解释排序
- **做得完** — 调用 Agent 完成代码修改、测试和 PR 草案生成
- **推得安全** — 审批前不执行任何 GitHub 写操作
- **可复用** — 核心 70% 代码零修改适配其他 Agent 宿主

## 许可证

MIT
