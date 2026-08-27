/**
 * GitHubPort — GitHub API 接口
 *
 * 核心引擎通过此接口与 GitHub 交互，不关心底层是 Octokit、MCP 还是 mock。
 */

// === 搜索相关 ===

export interface RepoSearchQuery {
  /** 自然语言关键词或 GitHub 搜索语法 */
  keywords: string
  /** 编程语言过滤 */
  language?: string
  /** 最少星数 */
  minStars?: number
  /** 许可证过滤 */
  license?: string
  /** 排序方式 */
  sort?: 'stars' | 'updated' | 'forks' | 'best-match'
  /** 每页数量 */
  perPage?: number
  /** 页码 */
  page?: number
}

export interface RepoSearchResult {
  totalCount: number
  items: RepositoryInfo[]
}

export interface IssueSearchQuery {
  /** 搜索关键词 */
  keywords?: string
  /** 指定仓库 owner/name */
  repository?: { owner: string; name: string }
  /** Issue 标签 */
  labels?: string[]
  /** 状态 */
  state?: 'open' | 'closed'
  /** 语言 */
  language?: string
  /** 排序 */
  sort?: 'created' | 'updated' | 'comments' | 'reactions'
  /** 创建时间不早于（ISO 字符串） */
  createdAfter?: string
  /** 每页 */
  perPage?: number
  /** 页码 */
  page?: number
}

export interface IssueSearchResult {
  totalCount: number
  items: IssueInfo[]
}

// === 仓库信息 ===

export interface RepositoryInfo {
  githubId: number
  owner: string
  name: string
  fullName: string
  description: string | null
  language: string | null
  license: string | null
  stars: number
  forks: number
  openIssues: number
  archived: boolean
  defaultBranch: string
  createdAt: string
  updatedAt: string
  pushedAt: string
  topics: string[]
  htmlUrl: string
}

export interface LicenseInfo {
  key: string
  name: string
  spdxId: string | null
}

// === Issue 信息 ===

export interface IssueInfo {
  githubId: number
  number: number
  title: string
  body: string | null
  state: 'open' | 'closed'
  labels: string[]
  assignees: string[]
  comments: number
  createdAt: string
  updatedAt: string
  htmlUrl: string
  repository?: { owner: string; name: string }
}

export interface IssueDetail extends IssueInfo {
  /** Issue 时间线中的关联 PR */
  relatedPRs: PRReference[]
  /** 仓库贡献指南（如果有） */
  contributingGuide: string | null
}

export interface PRReference {
  number: number
  title: string
  state: 'open' | 'closed' | 'merged'
  htmlUrl: string
}

export interface TimelineEvent {
  type: string
  createdAt: string
  actor?: string
  body?: string
}

// === 写操作 ===

export interface ForkResult {
  owner: string
  name: string
  fullName: string
  htmlUrl: string
  defaultBranch: string
}

export interface Commit {
  message: string
  files: Array<{ path: string; content: string }>
}

export interface CreatePRParams {
  owner: string
  repo: string
  title: string
  body: string
  head: string
  base: string
  draft?: boolean
}

export interface PRResult {
  number: number
  htmlUrl: string
  state: string
}

export interface ForkInfo {
  owner: string
  name: string
  fullName: string
}

// === 完整接口 ===

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
  getIssueTimeline(
    owner: string,
    name: string,
    number: number,
  ): Promise<TimelineEvent[]>

  // 写操作（发布阶段）
  forkRepository(owner: string, name: string): Promise<ForkResult>
  createBranch(
    owner: string,
    repo: string,
    branch: string,
    fromSha: string,
  ): Promise<void>
  pushCommits(
    owner: string,
    repo: string,
    branch: string,
    commits: Commit[],
  ): Promise<void>
  createPullRequest(params: CreatePRParams): Promise<PRResult>
  closePullRequest(owner: string, repo: string, number: number): Promise<void>
  deleteBranch(owner: string, repo: string, branch: string): Promise<void>

  // 状态检查
  getUserForks(owner: string, name: string): Promise<ForkInfo[]>
  checkBranchExists(
    owner: string,
    repo: string,
    branch: string,
  ): Promise<boolean>
  getDefaultBranchSha(owner: string, repo: string): Promise<string>
}
