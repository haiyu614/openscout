# OpenScout 技术方案与排期实现规划（v2）

> 基于 DSH（DeepSeek Harness）源码调研，确定技术架构、模块设计和里程碑排期。
> v2 变更：引入 Port/Adapter 分层架构，确保核心工作流可完整复用于 Codex、OpenCode 等其他宿主。

---

## 一、核心设计原则：Port/Adapter 分层

### 1.1 为什么需要分层

OpenScout 的定位文档（第 4.4 节、第 7.6 节）明确要求：

> 核心能力与宿主适配层保持分离，为后续适配 OpenCode、Codex、CLI 或 MCP 保留空间。
> GitHub 检索、候选评分、任务状态、审批门禁和发布逻辑应形成独立核心；DSH 只负责提供 Agent 能力和交互入口。

当前技术方案 v1 的核心逻辑直接写成 Cordis 插件（`ctx.*` 调用遍布），这意味着换宿主等于全部重写。v2 引入六面体架构（Hexagonal Architecture / Ports & Adapters），将核心逻辑与任何宿主框架解耦。

### 1.2 分层架构总览

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     宿主适配层 (Host Adapters)                            │
│                                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────┐  ┌─────────────┐  │
│  │ DSH Adapter  │  │Codex Adapter │  │OpenCode    │  │ CLI/MCP     │  │
│  │ (Cordis      │  │(hooks.json + │  │Adapter     │  │ Adapter     │  │
│  │  plugins)    │  │ file-based)  │  │(Go FFI/IPC)│  │             │  │
│  └──────┬───────┘  └──────────────┘  └────────────┘  └─────────────┘  │
│         │                                                               │
├─────────┼───────────────────────────────────────────────────────────────┤
│         │          宿主接口层 (Host Ports)                                │
│         │                                                               │
│  ┌──────▼───────────────────────────────────────────────────────────┐  │
│  │  AgentPort      │ 委托 Agent 完成代码理解/编辑/测试               │  │
│  │  ApprovalPort   │ 请求用户审批一个操作                             │  │
│  │  NotifyPort     │ 向用户推送状态变更/通知                          │  │
│  │  SchedulerPort  │ 注册/取消定时回调                               │  │
│  │  ConversationPort│多轮对话能力（与 PR 工作项关联）                  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                  OpenScout 核心引擎 (Core)                               │
│                  ※ 纯 TypeScript 库，零框架依赖 ※                        │
│                                                                         │
│  ┌────────────────┐ ┌─────────────────┐ ┌──────────────────────────┐  │
│  │ TaskEngine      │ │ SearchEngine    │ │ PRWorkflowEngine         │  │
│  │ - CRUD          │ │ - 仓库搜索      │ │ - 状态机                  │  │
│  │ - 状态流转       │ │ - Issue 筛选    │ │ - 版本管理                │  │
│  │ - 配额管理       │ │ - 候选排序      │ │ - 审批绑定                │  │
│  └────────────────┘ └─────────────────┘ │ - 贡献包定义              │  │
│                                          └──────────────────────────┘  │
│  ┌────────────────┐ ┌─────────────────┐ ┌──────────────────────────┐  │
│  │ DedupEngine     │ │ ContribEngine   │ │ PublishEngine             │  │
│  │ - 8条规则       │ │ - 可行性预检     │ │ - 发布前校验              │  │
│  │ - 墓碑管理       │ │ - 工作流编排     │ │ - fork/push/PR           │  │
│  │ - 跨任务去重     │ │ - 验证收集       │ │ - 关闭/删除              │  │
│  └────────────────┘ └─────────────────┘ └──────────────────────────┘  │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│              基础设施接口层 (Infrastructure Ports)                        │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  StoragePort    │ 持久化（CRUD + 原子更新 + 事件通知）             │  │
│  │  GitHubPort     │ GitHub API（搜索/仓库/Issue/PR/fork/push）      │  │
│  │  FileSystemPort │ 文件操作（工作区创建/读写/清理）                  │  │
│  │  ShellPort      │ 命令执行（git clone, npm test, etc.）           │  │
│  │  CredentialPort │ 凭据解析（GitHub Token）                        │  │
│  │  ClockPort      │ 当前时间（可测试）                               │  │
│  │  LogPort        │ 日志输出                                        │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│            基础设施适配层 (Infrastructure Adapters)                       │
│                                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐                 │
│  │ DSH Storage  │  │ SQLite       │  │ File-based    │                 │
│  │ Adapter      │  │ Adapter      │  │ JSON Adapter  │                 │
│  │(domain KV)   │  │(direct)      │  │(for Codex)    │                 │
│  └──────────────┘  └──────────────┘  └───────────────┘                 │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐                 │
│  │ Octokit      │  │ Node FS      │  │ DSH Shell     │                 │
│  │ Adapter      │  │ Adapter      │  │ Adapter       │                 │
│  └──────────────┘  └──────────────┘  └───────────────┘                 │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1.3 各层职责

| 层 | 职责 | 依赖方向 | 可替换性 |
|---|---|---|---|
| **Core（核心引擎）** | 业务逻辑：状态机、排序、去重、配额、版本管理、工作流编排 | 只依赖 Port 接口（自己定义的） | 永不替换，是产品核心 |
| **Host Ports（宿主接口）** | 定义 Agent 编排、审批、通知等宿主提供的能力接口 | Core 消费它 | 接口稳定，实现可换 |
| **Infrastructure Ports（基础设施接口）** | 定义持久化、GitHub API、文件系统等外部依赖接口 | Core 消费它 | 接口稳定，实现可换 |
| **DSH Adapter（DSH 适配层）** | 将 Core 的 Port 接口对接到 Cordis 服务（`ctx.*`） | 依赖 Core + DSH | 换宿主时整体替换 |
| **Infrastructure Adapters** | 具体外部依赖实现（Octokit、Node FS 等） | 依赖 Port 接口 | 可按环境替换 |

### 1.4 核心代码的可复用保证

**规则：Core 层不允许出现以下 import：**
- ❌ `@deepseek-ai/cordis` 或任何 `@deepseek-ai/dsh-*`
- ❌ `node:fs` / `node:child_process`（通过 Port）
- ❌ `@octokit/*`（通过 Port）
- ❌ 任何框架特有概念（`ctx`、`inject`、`apply`、`effect`）

**Core 层允许：**
- ✅ `zod`（Schema 校验，跨平台通用）
- ✅ 纯 TypeScript 类型和接口
- ✅ 标准库（`Promise`、`Map`、`Set`、`Date`）
- ✅ 自定义错误类型
- ✅ 事件发射器（自己实现或 `eventemitter3` 等零依赖库）

---

## 二、包结构规划（修订版）

```
openscout/                          # 独立仓库
├── packages/
│   ├── core/                       # ★ 核心引擎（零框架依赖）
│   │   ├── package.json            # dependencies: { zod }（仅此一个）
│   │   └── src/
│   │       ├── index.ts            # 公共 API 导出
│   │       ├── ports/              # 所有 Port 接口定义
│   │       │   ├── storage.ts      # StoragePort
│   │       │   ├── github.ts       # GitHubPort
│   │       │   ├── agent.ts        # AgentPort
│   │       │   ├── approval.ts     # ApprovalPort
│   │       │   ├── scheduler.ts    # SchedulerPort
│   │       │   ├── filesystem.ts   # FileSystemPort
│   │       │   ├── shell.ts        # ShellPort
│   │       │   ├── credential.ts   # CredentialPort
│   │       │   ├── notify.ts       # NotifyPort
│   │       │   └── clock.ts        # ClockPort
│   │       ├── engines/            # 业务逻辑引擎
│   │       │   ├── task.ts         # TaskEngine（CRUD + 状态流转 + 配额）
│   │       │   ├── search.ts       # SearchEngine（仓库发现 + Issue 筛选）
│   │       │   ├── ranker.ts       # CandidateRanker（过滤 + 评分）
│   │       │   ├── dedup.ts        # DedupEngine（8 条规则 + 墓碑）
│   │       │   ├── preflight.ts    # ContributionPreflight（可行性检查）
│   │       │   ├── pr-workflow.ts  # PRWorkflowEngine（状态机 + 版本）
│   │       │   ├── orchestrator.ts # ContribOrchestrator（编排代码工作）
│   │       │   ├── bundle.ts       # ReviewBundleBuilder（生成审阅包）
│   │       │   ├── approval.ts     # ApprovalGate（版本绑定 + 失效）
│   │       │   ├── publisher.ts    # PublishEngine（发布前校验 + 执行）
│   │       │   └── scheduler.ts    # SchedulerEngine（cron 解析 + 触发）
│   │       ├── models/             # 数据模型（纯类型 + zod schema）
│   │       │   ├── task.ts
│   │       │   ├── task-run.ts
│   │       │   ├── pr-work-item.ts
│   │       │   ├── dedup.ts
│   │       │   ├── quota.ts
│   │       │   └── review-bundle.ts
│   │       ├── errors.ts           # 错误类型
│   │       └── events.ts           # 核心事件定义（EventEmitter 接口）
│   │
│   ├── github-adapter/             # GitHub API 适配（Octokit）
│   │   ├── package.json            # deps: { @octokit/rest, @octokit/graphql }
│   │   └── src/
│   │       ├── index.ts            # 实现 GitHubPort
│   │       ├── search.ts
│   │       ├── repository.ts
│   │       ├── issue.ts
│   │       ├── publish.ts
│   │       └── rate-limit.ts
│   │
│   ├── storage-sqlite/             # SQLite 持久化适配（独立于 DSH）
│   │   ├── package.json            # deps: { better-sqlite3 }
│   │   └── src/
│   │       └── index.ts            # 实现 StoragePort
│   │
│   ├── adapter-dsh/                # ★ DSH 宿主适配层
│   │   ├── package.json            # deps: { @deepseek-ai/cordis, core, github-adapter, ... }
│   │   └── src/
│   │       ├── index.ts            # Cordis 插件入口（apply/inject）
│   │       ├── plugin-tools.ts     # 注册 model-facing tools（调用 Core API）
│   │       ├── plugin-scheduler.ts # Cordis timer → SchedulerPort
│   │       ├── plugin-approval.ts  # ctx.approval → ApprovalPort
│   │       ├── adapter-storage.ts  # ctx.storageDomain → StoragePort
│   │       ├── adapter-agent.ts    # ctx.subagents → AgentPort
│   │       ├── adapter-shell.ts    # ctx.shell → ShellPort
│   │       ├── adapter-fs.ts       # ctx.fs → FileSystemPort
│   │       ├── adapter-cred.ts     # ctx.credentials → CredentialPort
│   │       └── preset/             # Agent Preset 配置
│   │           ├── agent.cordis.yml
│   │           └── skills/
│   │               └── openscout/SKILL.md
│   │
│   ├── adapter-codex/              # 未来：Codex 适配层
│   │   └── src/
│   │       ├── index.ts            # Codex hooks 入口
│   │       ├── adapter-storage.ts  # 文件 JSON → StoragePort
│   │       ├── adapter-agent.ts    # Codex CLI → AgentPort
│   │       └── adapter-approval.ts # stdin prompt → ApprovalPort
│   │
│   ├── adapter-mcp/                # 未来：MCP Server 适配层
│   │   └── src/
│   │       └── index.ts            # 将 Core API 暴露为 MCP tools
│   │
│   └── adapter-cli/                # 未来：独立 CLI
│       └── src/
│           └── index.ts            # 命令行直接运行（无 Agent 宿主）
│
├── package.json                    # monorepo root
├── tsconfig.json
└── vitest.config.ts
```

---

## 三、Port 接口设计（核心契约）

### 3.1 StoragePort — 持久化

```typescript
// core/src/ports/storage.ts

/** 核心不关心底层是 SQLite/DSH-Domain/文件/内存 */
export interface StoragePort {
  // 任务表
  tasks: TablePort<TaskId, TaskRecord>
  // 任务运行表
  taskRuns: TablePort<TaskRunId, TaskRunRecord>
  // PR 工作项表
  prWorkItems: TablePort<PRWorkItemId, PRWorkItemRecord>
  // 去重注册表
  dedup: TablePort<DedupKey, DedupRecord>
  // 配额窗口表
  quotaWindows: TablePort<QuotaWindowKey, QuotaWindowRecord>
}

export interface TablePort<K extends string, V> {
  get(key: K): V | undefined              // 同步读取
  put(key: K, value: V): Promise<void>     // 持久写入
  delete(key: K): Promise<boolean>
  update(key: K, fn: (current: V) => V): Promise<V>  // 原子读写
  entries(): IterableIterator<[K, V]>
  keys(): IterableIterator<K>
  readonly size: number
}

/** 存储层变更事件（用于通知调度器等） */
export interface StorageEvents {
  onChanged(table: string, key: string, operation: 'put' | 'deleted'): void
}
```

### 3.2 GitHubPort — GitHub API

```typescript
// core/src/ports/github.ts

export interface GitHubPort {
  // 搜索
  searchRepositories(query: RepoSearchQuery): Promise<RepoSearchResult>
  searchIssues(query: IssueSearchQuery): Promise<IssueSearchResult>

  // 仓库信息
  getRepository(owner: string, name: string): Promise<RepositoryInfo>
  getContributingGuide(owner: string, name: string): Promise<string | null>
  getLicense(owner: string, name: string): Promise<LicenseInfo | null>

  // Issue 信息
  getIssue(owner: string, name: string, number: number): Promise<IssueDetail>
  getIssueTimeline(owner: string, name: string, number: number): Promise<TimelineEvent[]>
  getRelatedPRs(owner: string, name: string, issueNumber: number): Promise<PRReference[]>

  // 写操作（发布阶段）
  forkRepository(owner: string, name: string): Promise<ForkResult>
  createBranch(owner: string, repo: string, branch: string, sha: string): Promise<void>
  pushCommits(owner: string, repo: string, branch: string, commits: Commit[]): Promise<void>
  createPullRequest(params: CreatePRParams): Promise<PRResult>
  closePullRequest(owner: string, repo: string, number: number): Promise<void>
  deleteBranch(owner: string, repo: string, branch: string): Promise<void>

  // 状态检查
  getUserForks(owner: string, name: string): Promise<ForkInfo[]>
  checkBranchExists(owner: string, repo: string, branch: string): Promise<boolean>
}
```

### 3.3 AgentPort — Agent 编排

```typescript
// core/src/ports/agent.ts

/** 宿主提供的 Agent 编排能力 */
export interface AgentPort {
  /**
   * 委托 Agent 完成一段代码工作。
   * 核心只描述意图和约束，不关心 Agent 内部实现。
   */
  delegateCodeWork(request: CodeWorkRequest): Promise<CodeWorkResult>
}

export interface CodeWorkRequest {
  /** 工作描述（给 Agent 的 prompt） */
  instruction: string
  /** 工作目录（已 clone 的仓库路径） */
  workingDirectory: string
  /** 超时（毫秒） */
  timeoutMs?: number
  /** 取消信号 */
  signal?: AbortSignal
  /** 约束：允许 Agent 使用的工具白名单 */
  allowedTools?: string[]
}

export interface CodeWorkResult {
  success: boolean
  /** Agent 产出的文件变更 */
  changedFiles?: string[]
  /** Agent 执行的验证结果 */
  validationResults?: ValidationResult[]
  /** 失败原因 */
  failureReason?: string
  /** Agent 的自然语言总结 */
  summary?: string
}
```

### 3.4 ApprovalPort — 审批

```typescript
// core/src/ports/approval.ts

export interface ApprovalPort {
  /**
   * 请求用户对一个操作的批准。
   * 返回批准/拒绝/取消/不可用。
   */
  requestApproval(request: ApprovalRequest): Promise<ApprovalOutcome>
}

export interface ApprovalRequest {
  /** 操作描述 */
  action: string
  /** 详情（展示给用户） */
  details: Record<string, unknown>
  /** 关联的 PR 工作项 */
  workItemId?: PRWorkItemId
  /** 绑定的版本号（任何变更自动失效） */
  boundVersion?: number
}

export type ApprovalOutcome = 'approved' | 'rejected' | 'cancelled' | 'unavailable'
```

### 3.5 SchedulerPort — 定时调度

```typescript
// core/src/ports/scheduler.ts

export interface SchedulerPort {
  /**
   * 注册一个定时回调。
   * 返回取消函数。
   * 核心只说"在什么时间调我"，不关心实现是 setTimeout 还是 cron daemon。
   */
  scheduleAt(time: Date, callback: () => Promise<void>): CancelFn
  scheduleAfter(delayMs: number, callback: () => Promise<void>): CancelFn
}

export type CancelFn = () => void
```

### 3.6 其他 Port

```typescript
// FileSystemPort — 文件操作
export interface FileSystemPort {
  createDirectory(path: string): Promise<void>
  removeDirectory(path: string): Promise<void>
  readFile(path: string): Promise<string>
  writeFile(path: string, content: string): Promise<void>
  exists(path: string): Promise<boolean>
  glob(pattern: string, cwd: string): Promise<string[]>
  getDiff(cwd: string): Promise<string>      // git diff
}

// ShellPort — 命令执行
export interface ShellPort {
  execute(command: string, options: ShellOptions): Promise<ShellResult>
}

// CredentialPort — 凭据
export interface CredentialPort {
  resolveGitHubToken(): Promise<string | undefined>
}

// NotifyPort — 通知
export interface NotifyPort {
  notifyUser(notification: Notification): void
}

// ClockPort — 时间（可测试）
export interface ClockPort {
  now(): Date
}
```

---

## 四、各宿主适配对照

### 4.1 DSH Adapter 实现

| Port | DSH 实现 |
|------|----------|
| `StoragePort` | `ctx.storageDomain.open(openscoutDomain)` → 映射 table API |
| `GitHubPort` | `@octokit/rest`（可直接复用，不依赖宿主） |
| `AgentPort` | `ctx.subagents.start('spawn', {...})` → 解析结果 |
| `ApprovalPort` | `ctx.approval.request(...)` + 自建版本绑定逻辑 |
| `SchedulerPort` | `ctx.effect(() => setTimeout(...))` + `domain/changed` |
| `FileSystemPort` | `ctx.fs` 或直接 `node:fs`（沙箱内） |
| `ShellPort` | `ctx.shell.execute(...)` |
| `CredentialPort` | `ctx.credentials.resolve(ref)` |
| `NotifyPort` | `agent.inject(...)` 或 `agent.steer(...)` |
| `ClockPort` | `{ now: () => new Date() }` |

DSH Adapter 额外职责：
- 将 Core 的能力注册为 model-facing tools（`defineTool`）
- 将 Core 事件翻译为 DSH session events
- 管理 Agent Preset 配置

### 4.2 Codex Adapter（未来）

| Port | Codex 实现 |
|------|----------|
| `StoragePort` | 本地 SQLite（`better-sqlite3`） |
| `GitHubPort` | 同 Octokit（复用 `github-adapter` 包） |
| `AgentPort` | `codex --quiet -p "..." --cwd ...`（CLI 子进程） |
| `ApprovalPort` | stdin/stdout 交互式确认 |
| `SchedulerPort` | Node.js `setTimeout` / 系统 crontab |
| `FileSystemPort` | Node.js `fs/promises` |
| `ShellPort` | `child_process.exec` |
| `CredentialPort` | `process.env.GITHUB_TOKEN` |
| `NotifyPort` | console.log / terminal 通知 |
| `ClockPort` | `{ now: () => new Date() }` |

### 4.3 MCP Server Adapter（未来）

| 实现方式 | 说明 |
|----------|------|
| 将 Core 每个 Engine 方法暴露为 MCP tool | 任何支持 MCP 的 Agent 都能调用 |
| Storage/GitHub/Shell 由调用侧提供 | 或由 MCP Server 进程自带 |

---

## 五、修订后的包结构与依赖关系

```
依赖方向（箭头 = 依赖）：

adapter-dsh ──→ core ←── adapter-codex
     │              ↑           │
     │              │           │
     ▼              │           ▼
DSH packages   github-adapter  Node built-ins
               storage-sqlite
```

**关键规则：`core` 不依赖任何 adapter，adapter 依赖 core。**

`github-adapter` 和 `storage-sqlite` 是 Infrastructure Adapter，它们实现 Core 定义的 Port 接口，可被任何 Host Adapter 引用。

---

## 六、DSH 扩展机制调研结论

（与 v1 相同，此处省略，详见上方 1.1-1.3 节的调研结果）

### 可直接复用的 DSH 能力

| DSH 能力 | 服务 | OpenScout 用途 | 对应 Port |
|----------|------|----------------|-----------|
| Domain KV 存储 | `ctx.storageDomain` | 持久化 | StoragePort 的 DSH 实现 |
| 后台任务 | `ctx.jobs` | 长耗时 GitHub 操作 | 内部实现细节 |
| 工具注册 | `ctx.tools` | model-facing 命令 | DSH Adapter 独有 |
| 审批门禁 | `ctx.approval` | 发布前用户审批 | ApprovalPort 的 DSH 实现 |
| 凭据管理 | `ctx.credentials` | GitHub Token | CredentialPort 的 DSH 实现 |
| 子代理编排 | `ctx.subagents` | 代码分析/编辑/测试 | AgentPort 的 DSH 实现 |
| 沙箱策略 | `ctx.sandbox` | 隔离工作区 | ShellPort 的约束层 |
| MCP 桥接 | `dsh-mcp-client` | 可选 GitHub 工具补充 | 不进入 Core |

---

## 七、里程碑排期（修订版）

### M0: 基础骨架 + Port 定义（2.5 周）

| 任务 | 工作量 | 产出 |
|------|--------|------|
| monorepo 初始化（pnpm workspaces + tsconfig + vitest） | 1d | 可构建项目 |
| 定义全部 Port 接口（9 个 Port + 类型） | 3d | `core/src/ports/*.ts` |
| 数据模型定义（zod schema，纯类型） | 2d | `core/src/models/*.ts` |
| StoragePort 内存实现（用于单测） | 1d | `InMemoryStorage` |
| StoragePort SQLite 实现 | 2d | `storage-sqlite` 包 |
| GitHubPort Octokit 实现（搜索/仓库/Issue） | 3d | `github-adapter` 包 |
| ClockPort / LogPort 实现 | 0.5d | 基础设施 |

### M1: 核心搜索引擎（3 周）

| 任务 | 工作量 | 产出 |
|------|--------|------|
| SearchEngine（仓库搜索逻辑） | 3d | 纯逻辑，可独立单测 |
| CandidateRanker（硬过滤 + 可解释评分） | 3d | 评分逻辑，可独立单测 |
| SearchEngine（Issue 搜索 + 可行性预检） | 3d | Issue 评估 |
| DedupEngine（Issue 主键 + 远端 PR 去重） | 3d | 去重基础逻辑 |
| 单元测试（Mock Port，覆盖核心路径） | 3d | >80% 覆盖率 |

### M2: DSH Adapter — 搜索闭环（2 周）

| 任务 | 工作量 | 产出 |
|------|--------|------|
| DSH Adapter 骨架（Cordis 插件 + Port 对接） | 2d | 插件可加载 |
| adapter-storage（Domain KV → StoragePort） | 2d | 持久化对接 |
| adapter-credential（`ctx.credentials` → CredentialPort） | 1d | Token 管理 |
| plugin-tools: 搜索工具注册（search_repos, search_issues） | 3d | model-facing |
| Agent Preset + Skill 配置 | 1d | 开箱可用 |
| 端到端集成测试 | 1d | 搜索流程通 |

### M3: 贡献包生成（3 周）

| 任务 | 工作量 | 产出 |
|------|--------|------|
| ContribOrchestrator（工作流定义，纯逻辑） | 3d | 编排逻辑 |
| ReviewBundleBuilder（diff + 摘要 + PR 文案） | 2d | 贡献包结构 |
| PRWorkflowEngine（10 状态流转） | 3d | 状态机 |
| adapter-agent（`ctx.subagents` → AgentPort） | 2d | DSH Agent 对接 |
| adapter-fs + adapter-shell（工作区管理） | 2d | 文件/命令对接 |
| 集成测试（模拟 Agent 返回 → 生成贡献包） | 3d | 端到端 |

### M4: 审批与发布（2.5 周）

| 任务 | 工作量 | 产出 |
|------|--------|------|
| ApprovalGate（版本绑定 + 自动失效，纯逻辑） | 2d | Core 内完成 |
| PublishEngine（发布前校验 + 执行，纯逻辑） | 3d | Core 内完成 |
| GitHubPort 写操作实现（fork/push/PR/close） | 3d | github-adapter |
| adapter-approval（`ctx.approval` → ApprovalPort） | 2d | DSH 对接 |
| plugin-tools: approve/publish 工具注册 | 1d | model-facing |
| 安全测试（证明未批准时无写操作） | 1.5d | 安全验证 |

### M5: 定时任务（3 周）

| 任务 | 工作量 | 产出 |
|------|--------|------|
| SchedulerEngine（Cron 解析 + 触发逻辑，纯逻辑） | 3d | Core 内 |
| TaskEngine（CRUD + 配额 + 水位管理，纯逻辑） | 3d | Core 内 |
| adapter-scheduler（Cordis timer → SchedulerPort） | 2d | DSH 对接 |
| plugin-scheduler（启动对账 + domain 事件监听） | 2d | DSH 特有 |
| plugin-tools: 任务管理工具注册 | 2d | model-facing |
| 幂等 + 并发单测 | 3d | 正确性验证 |

### M6: 多轮协作 + 去重完善（2 周）

| 任务 | 工作量 | 产出 |
|------|--------|------|
| PRWorkflowEngine 扩展（多轮修改 + 版本递增） | 3d | Core 内 |
| DedupEngine 完善（墓碑/跨任务/意图去重） | 3d | Core 内 |
| plugin-tools: PR 工作项多轮操作工具 | 2d | model-facing |
| 端到端测试 | 2d | 全流程 |

### M7: 打磨 + 演示（2 周）

| 任务 | 工作量 | 产出 |
|------|--------|------|
| 错误恢复与断点续做 | 2d | 健壮性 |
| 状态展示优化 | 2d | 用户体验 |
| MVP 14 项验收逐一验证 | 3d | 完整演示 |
| 文档（API doc + 适配指南 + 安全说明） | 3d | 文档 |

---

## 八、排期总览

```
Week 1-2.5 │ M0: 骨架 + Port 定义      │ 接口契约 + 基础实现
Week 3-5   │ M1: 核心搜索引擎          │ 纯逻辑 Core，可独立测试
Week 6-7   │ M2: DSH 搜索闭环          │ 首个可用的 DSH 集成
Week 8-10  │ M3: 贡献包生成            │ Agent 编排 + 代码工作
Week 11-13 │ M4: 审批与发布            │ 安全发布闭环
Week 14-16 │ M5: 定时任务              │ 持续扫描
Week 17-18 │ M6: 多轮协作              │ 完整生命周期
Week 19-20 │ M7: 打磨 + 演示           │ MVP 就绪
```

**总计：约 20 周（5 个月），单人全职。**
**2 人协作可压缩至 12-14 周**（Core + Adapter 并行开发）。

增加约 3 周是因为：
- Port 接口设计本身需要时间（但这是一次性投资）
- Core 和 Adapter 各自需要独立测试
- 但换来的回报是：**Core 的 ~70% 代码可零修改复用于其他宿主**

---

## 九、复用性验证清单

在每个里程碑结束时，用以下问题验证核心可复用性：

- [ ] `packages/core` 能否在没有 `adapter-dsh` 的情况下独立构建和测试？
- [ ] Core 的单元测试是否全部使用 Mock Port（InMemoryStorage 等）？
- [ ] 是否能用 50 行以下代码写一个 CLI Adapter 运行同一个 SearchEngine？
- [ ] Core 的 `package.json` 中是否只有 `zod` 一个运行时依赖？
- [ ] 更换 StoragePort 实现（SQLite → 文件 JSON）后，所有 Core 测试是否仍通过？

---

## 十、各宿主适配成本预估

| 宿主 | 适配工作量 | 说明 |
|------|------------|------|
| DSH | M0-M7 中已包含 | 首版宿主，全部 Adapter 已实现 |
| Codex | ~3 周 | AgentPort（CLI 子进程）+ ApprovalPort（stdin）+ 工具映射为 hooks |
| OpenCode | ~4 周 | Go↔Node IPC + AgentPort（Go Agent API）+ 存储适配 |
| 独立 CLI | ~2 周 | 无 Agent 委托，手动模式，直接调 Core API |
| MCP Server | ~2 周 | Core 方法 → MCP tool 映射，最简单的适配 |

---

## 十一、风险缓解（补充）

| 风险 | 缓解 |
|------|------|
| Port 接口设计不够通用 | M1 结束后做"Codex 模拟适配"验证，发现问题趁早调整 |
| Port 抽象引入性能开销 | 同步读（StoragePort.get）保持同步；异步写天然通过 Promise |
| Core 逻辑意外引入宿主依赖 | CI 添加 `no-restricted-imports` lint 规则，禁止 Core 导入宿主包 |
| 接口变更频繁 | Port 接口标注 `@since` 版本，变更走 deprecation 周期 |

---

## 十二、总结

| 维度 | v1 方案 | v2 方案（本文） |
|------|---------|----------------|
| 核心复用率 | ~20%（全部绑定 Cordis） | ~70%（Core 零框架依赖） |
| 适配新宿主成本 | 几乎全部重写 | 2-4 周 Adapter 开发 |
| 测试独立性 | 需要完整 DSH 运行时 | Core 可纯单元测试 |
| 首版开发成本 | 17 周 | 20 周（+3 周 Port 设计） |
| MCP Server 发布 | 大量重构 | 直接映射 Core API |
| 长期维护 | 升级 DSH 影响全部代码 | 只影响 Adapter 层 |

**结论：v2 方案以约 +15% 首版开发成本，换取核心代码 70% 可复用 + 适配新宿主仅需 2-4 周的战略优势。对于一个明确要跨宿主的产品，这是正确的架构投资。**

---

## 十三、实现进度（项目管理）

| 里程碑 | 状态 | 完成内容 | 验证 |
|--------|------|----------|------|
| **M0** | ✅ 已完成并推送 | monorepo(pnpm)+tsconfig+vitest；9 个 Port 接口；数据模型(zod)；`InMemoryStorage`；`OctokitGitHubAdapter`；`ClockPort` | `tsc --build` 通过；`github-adapter` 类型修复 |
| **M1** | ✅ 已完成并推送 | `CandidateRanker`（仓库+Issue 可解释评分，可独立单测）；`ContributionPreflight`（Issue 可行性，可注入时钟）；`DedupEngine`（§6.2 八条去重规则的 1/2/3/4/5/6/8 与墓碑）；`SearchEngine` 重构为委托 Ranker；33 个单测（Mock Port） | `tsc --build` 通过；`vitest` 33/33 通过；engines 覆盖率 94–100% |
| **M2** | ✅ 已推送 | `packages/adapter-dsh`：OpenScout DSH 域声明（5 表）；`DshStorage implements StoragePort`（Domain→Core 五表）；`DshCredentialPort implements CredentialPort`（经 `ctx.credentials.resolve`）；复用 `OctokitGitHubAdapter`；模型可见工具 `search_repos`/`search_issues`；Cordis 插件入口（开域/构造引擎/注册工具/可逆转清理） | `tsc --build` 通过；`vitest` 46/46 通过；仓库覆盖率 97.39%；运行态动态插件验证 `storageDomain.open`/`credentials.resolve`/`harness.defineTool`+`ctx.tools.register` 真实契约（见 `docs/m2-evaluation.md`） |
| **M3** | ✅ 已推送 | Core 纯逻辑三件套：`ReviewBundleBuilder`（diff+摘要+PR文案）、`PRWorkflowEngine`（10 状态机，fail-closed）、`ContribOrchestrator`（去重→Agent→ReviewBundle→状态流转，到 review 为止）；复用 `DedupEngine`/`StoragePort`/`AgentPort` | `tsc --build` 通过；`vitest` 78/78 通过；仓库覆盖率 97.79%；`core/src/engines/contrib` 98.82%；Core 零 DSH 依赖（见 `docs/m3-evaluation.md`） |
| **M4** | ✅ 已推送 | Core：`ApprovalGate`（版本绑定+fail-closed）、`PublishEngine`（fork→branch→push→PR→published，失败回写 failed）、`ContribOrchestrator.approve`（review→approved 绑版本）；`PRWorkItemRecord.reviewBundle` 字段；adapter-dsh：`DshApprovalPort`、`openscout_approve`/`openscout_publish` 工具；复用 `github-adapter` 写操作（M0 实现） | `tsc --build` 通过；`vitest` 99/99 通过；仓库覆盖率 90.19%（adapter 胶水层真机态验证）；Core 零 DSH 依赖（见 `docs/m4-evaluation.md`） |
| **M5** | ✅ 已完成（待推送） | Core 纯逻辑：`cron.ts`（cron/@every 解析+时区感知 nextOccurrence）、`TaskEngine`（CRUD+状态机+日/周配额窗口+水位）、`SchedulerEngine`（基于 SchedulerPort 排程/重排程/fail-safe）、`ScanOrchestrator`（单次运行：搜索→去重→生成，受 maxIssuesPerRun/maxPRsPerRun/日周配额约束，记 TaskRun+水位）；adapter-dsh：`plugin-scheduler.ts`（Cordis timer→SchedulerPort + runHandler 组装 ScanOrchestrator）、`task-tools.ts`（`openscout_create/list/activate/pause/delete_task`）；复用 M1/M3/M4 引擎 | `tsc --build` 通过；`vitest` 125/125 通过（M5 +26 个：cron 9 / task 7 / scheduler 5 / scan 5）；Core 零 DSH 依赖（见 `docs/m5-evaluation.md`） |

**复用性验证（M1 末）**
- [x] `packages/core` 在没有 `adapter-dsh` 的情况下独立构建和测试通过
- [x] Core 单元测试全部使用 Mock Port（`InMemoryStorage` + `makeMockGithub`）
- [x] `package.json` 运行时依赖仅 `zod`
- [x] 更换 `StoragePort` 实现（内存）后所有 Core 测试通过

 **复用性验证（M2 末）**
 - [x] `packages/adapter-dsh` 是唯一感知 DSH 的层；Core 零 DSH/Cordis 导入（grep 确认）
 - [x] adapter-dsh 仅依赖 Core 接口（`StoragePort`/`CredentialPort`/`GitHubPort`）+ DSH 宿主服务
 - [x] adapter-dsh 在 monorepo 内独立 `tsc --build`/vitest（DSH 类型以 ambient shim 垫片提供，运行时由宿主替代）
 - [x] 运行态动态插件实测 `storageDomain.open`/`credentials.resolve`/`harness.defineTool`+`ctx.tools.register` 真实契约
 - [ ] 真机实时 GitHub 搜索：受 `.credentials.yaml` fine-grained token 已 401 失效 + 沙箱网络拦截阻断（非代码缺陷）；待有效 token 后补 `scripts/live-search-loop.mjs`

 **复用性验证（M3 末）**
 - [x] `packages/core` 零 DSH/Cordis 导入（grep 确认）；M3 代码全在 Core，复用已有 Port/模型
 - [x] `ContribOrchestrator` 仅依赖注入的 `StoragePort`/`DedupEngine`/`AgentPort`/`ClockPort`
 - [x] M3 三引擎均用 Mock Port 单测（32 个），含状态机 fail-closed 非法流转拒绝
 - [x] 全量测试 78/78 通过，仓库覆盖率 97.79%；M1/M2 单测无回归
 - [ ] 真机闭环（去重→Agent→ReviewBundle→发布）：待静态插件挂载能力 + `adapter-agent`/`adapter-fs`/`adapter-shell` 落地后真机跑通（与 M2 真机验证同源，环境令牌限制，非代码问题）

 **复用性验证（M4 末）**
 - [x] `packages/core` 零 DSH/Cordis 导入（grep 确认）；M4 Core 仅依赖 ApprovalPort/GitHubPort/StoragePort/ClockPort
 - [x] `PublishEngine` 不读文件系统（Core 零 fs 依赖）；文件字节经 `Commit[]` 由 Adapter 注入，符合端口/适配器边界
 - [x] `ApprovalGate` 版本绑定 + fail-closed（不可用/版本漂移/拒绝一律拦截）单测覆盖
 - [x] `github-adapter` 写操作（fork/branch/push/PR/close/deleteBranch）保持真实 Octokit 实现、M4 仅复用未改动
 - [x] 全量测试 99/99 通过，仓库覆盖率 90.19%；M1/M2/M3 单测无回归
 - [ ] 真机闭环发布（fork→push→草稿 PR）待静态插件挂载能力 + 有效 token 后跑通（adapter-dsh 已注册 `openscout_publish`）
 - [ ] 宿主审批设施 `ctx.approval` 真机实现（当前 shim 声明可选，缺省 fail-closed）

> 注：M1 排期原计划 3 周，因 M0 已包含 `SearchEngine` 雏形，实际聚焦于把评分/去重抽离为可独立测试的纯逻辑 + 补齐八条去重规则 + 单测，已在一次实现内完成。M2 起进入 DSH Adapter 搜索闭环。
