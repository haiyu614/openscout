/**
 * OctokitGitHubAdapter — 基于 @octokit/rest 的 GitHubPort 实现
 *
 * 可被任何宿主 Adapter 引用（DSH、Codex、CLI 均可复用）。
 * 通过 CredentialPort 逐操作获取 Token，支持热轮换。
 */

import { Octokit } from '@octokit/rest'
import type {
  GitHubPort,
  RepoSearchQuery,
  RepoSearchResult,
  IssueSearchQuery,
  IssueSearchResult,
  RepositoryInfo,
  IssueInfo,
  IssueDetail,
  LicenseInfo,
  TimelineEvent,
  ForkResult,
  Commit,
  CreatePRParams,
  PRResult,
  ForkInfo,
  CredentialPort,
} from '@openscout/core'

export class OctokitGitHubAdapter implements GitHubPort {
  private octokit: Octokit | null = null
  private lastToken: string | undefined

  constructor(private readonly credentials: CredentialPort) {}

  private async getClient(): Promise<Octokit> {
    const token = await this.credentials.resolveGitHubToken()
    if (!token) {
      throw new Error('GitHub token not available. Configure GITHUB_TOKEN.')
    }
    // 如果 token 变了，重新创建 client
    if (token !== this.lastToken) {
      this.octokit = new Octokit({ auth: token })
      this.lastToken = token
    }
    return this.octokit!
  }

  async searchRepositories(query: RepoSearchQuery): Promise<RepoSearchResult> {
    const client = await this.getClient()

    let q = query.keywords
    if (query.language) q += ` language:${query.language}`
    if (query.minStars) q += ` stars:>=${query.minStars}`
    if (query.license) q += ` license:${query.license}`

    const response = await client.search.repos({
      q,
      sort: query.sort === 'best-match' ? undefined : query.sort,
      per_page: query.perPage ?? 30,
      page: query.page ?? 1,
    })

    return {
      totalCount: response.data.total_count,
      items: response.data.items.map(mapRepository),
    }
  }

  async searchIssues(query: IssueSearchQuery): Promise<IssueSearchResult> {
    const client = await this.getClient()

    let q = query.keywords ?? ''
    if (query.repository) q += ` repo:${query.repository.owner}/${query.repository.name}`
    if (query.labels) q += query.labels.map(l => ` label:"${l}"`).join('')
    if (query.state) q += ` state:${query.state}`
    if (query.language) q += ` language:${query.language}`
    if (query.createdAfter) q += ` created:>=${query.createdAfter}`
    q += ' is:issue'

    const response = await client.search.issuesAndPullRequests({
      q: q.trim(),
      sort: query.sort,
      per_page: query.perPage ?? 30,
      page: query.page ?? 1,
    })

    return {
      totalCount: response.data.total_count,
      items: response.data.items
        .filter(item => !item.pull_request) // 排除 PR
        .map(mapIssue),
    }
  }

  async getRepository(owner: string, name: string): Promise<RepositoryInfo> {
    const client = await this.getClient()
    const { data } = await client.repos.get({ owner, repo: name })
    return mapRepository(data)
  }

  async getContributingGuide(owner: string, name: string): Promise<string | null> {
    const client = await this.getClient()
    try {
      // 尝试常见路径
      for (const path of ['CONTRIBUTING.md', 'contributing.md', '.github/CONTRIBUTING.md']) {
        try {
          const { data } = await client.repos.getContent({ owner, repo: name, path })
          if ('content' in data && data.content) {
            return Buffer.from(data.content, 'base64').toString('utf-8')
          }
        } catch {
          continue
        }
      }
      return null
    } catch {
      return null
    }
  }

  async getLicense(owner: string, name: string): Promise<LicenseInfo | null> {
    const client = await this.getClient()
    try {
      const { data } = await client.licenses.getForRepo({ owner, repo: name })
      if (!data.license) return null
      return {
        key: data.license.key,
        name: data.license.name,
        spdxId: data.license.spdx_id,
      }
    } catch {
      return null
    }
  }

  async getIssue(owner: string, name: string, number: number): Promise<IssueDetail> {
    const client = await this.getClient()
    const { data } = await client.issues.get({ owner, repo: name, issue_number: number })

    const timeline = await this.getIssueTimeline(owner, name, number)
    const contributingGuide = await this.getContributingGuide(owner, name)

    // 从时间线中提取关联 PR
    const relatedPRs = timeline
      .filter(e => e.type === 'cross-referenced')
      .map(e => ({
        number: 0,
        title: e.body ?? '',
        state: 'open' as const,
        htmlUrl: '',
      }))

    return {
      githubId: data.id,
      number: data.number,
      title: data.title,
      body: data.body,
      state: data.state as 'open' | 'closed',
      labels: data.labels.map(l => (typeof l === 'string' ? l : l.name ?? '')),
      assignees: data.assignees?.map(a => a.login) ?? [],
      comments: data.comments,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      htmlUrl: data.html_url,
      relatedPRs,
      contributingGuide,
    }
  }

  async getIssueTimeline(owner: string, name: string, number: number): Promise<TimelineEvent[]> {
    const client = await this.getClient()
    try {
      const { data } = await client.issues.listEventsForTimeline({
        owner,
        repo: name,
        issue_number: number,
        per_page: 100,
      })
      return data.map(event => ({
        type: event.event ?? 'unknown',
        createdAt: event.created_at ?? '',
        actor: 'actor' in event ? (event.actor as { login?: string })?.login : undefined,
      }))
    } catch {
      return []
    }
  }

  async forkRepository(owner: string, name: string): Promise<ForkResult> {
    const client = await this.getClient()
    const { data } = await client.repos.createFork({ owner, repo: name })
    return {
      owner: data.owner.login,
      name: data.name,
      fullName: data.full_name,
      htmlUrl: data.html_url,
      defaultBranch: data.default_branch,
    }
  }

  async createBranch(owner: string, repo: string, branch: string, fromSha: string): Promise<void> {
    const client = await this.getClient()
    await client.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branch}`,
      sha: fromSha,
    })
  }

  async pushCommits(owner: string, repo: string, branch: string, commits: Commit[]): Promise<void> {
    const client = await this.getClient()

    for (const commit of commits) {
      // 获取当前分支 SHA
      const { data: ref } = await client.git.getRef({ owner, repo, ref: `heads/${branch}` })
      const currentSha = ref.object.sha

      // 获取当前 tree
      const { data: currentCommit } = await client.git.getCommit({ owner, repo, commit_sha: currentSha })

      // 创建 blobs 和 tree
      const treeItems = await Promise.all(
        commit.files.map(async file => {
          const { data: blob } = await client.git.createBlob({
            owner,
            repo,
            content: Buffer.from(file.content).toString('base64'),
            encoding: 'base64',
          })
          return {
            path: file.path,
            mode: '100644' as const,
            type: 'blob' as const,
            sha: blob.sha,
          }
        }),
      )

      const { data: newTree } = await client.git.createTree({
        owner,
        repo,
        base_tree: currentCommit.tree.sha,
        tree: treeItems,
      })

      // 创建 commit
      const { data: newCommit } = await client.git.createCommit({
        owner,
        repo,
        message: commit.message,
        tree: newTree.sha,
        parents: [currentSha],
      })

      // 更新 ref
      await client.git.updateRef({
        owner,
        repo,
        ref: `heads/${branch}`,
        sha: newCommit.sha,
      })
    }
  }

  async createPullRequest(params: CreatePRParams): Promise<PRResult> {
    const client = await this.getClient()
    const { data } = await client.pulls.create({
      owner: params.owner,
      repo: params.repo,
      title: params.title,
      body: params.body,
      head: params.head,
      base: params.base,
      draft: params.draft ?? true,
    })
    return {
      number: data.number,
      htmlUrl: data.html_url,
      state: data.state,
    }
  }

  async closePullRequest(owner: string, repo: string, number: number): Promise<void> {
    const client = await this.getClient()
    await client.pulls.update({ owner, repo, pull_number: number, state: 'closed' })
  }

  async deleteBranch(owner: string, repo: string, branch: string): Promise<void> {
    const client = await this.getClient()
    await client.git.deleteRef({ owner, repo, ref: `heads/${branch}` })
  }

  async getUserForks(owner: string, name: string): Promise<ForkInfo[]> {
    const client = await this.getClient()
    const { data } = await client.repos.listForks({ owner, repo: name, per_page: 100 })
    return data.map(f => ({
      owner: f.owner.login,
      name: f.name,
      fullName: f.full_name,
    }))
  }

  async checkBranchExists(owner: string, repo: string, branch: string): Promise<boolean> {
    const client = await this.getClient()
    try {
      await client.git.getRef({ owner, repo, ref: `heads/${branch}` })
      return true
    } catch {
      return false
    }
  }

  async getDefaultBranchSha(owner: string, repo: string): Promise<string> {
    const client = await this.getClient()
    const { data: repoData } = await client.repos.get({ owner, repo })
    const { data: ref } = await client.git.getRef({
      owner,
      repo,
      ref: `heads/${repoData.default_branch}`,
    })
    return ref.object.sha
  }
}

// === Mapper 函数 ===

function mapRepository(data: Record<string, unknown>): RepositoryInfo {
  return {
    githubId: data.id as number,
    owner: (data.owner as { login: string }).login,
    name: data.name as string,
    fullName: data.full_name as string,
    description: (data.description as string) ?? null,
    language: (data.language as string) ?? null,
    license: (data.license as { key?: string } | null)?.key ?? null,
    stars: (data.stargazers_count as number) ?? 0,
    forks: (data.forks_count as number) ?? 0,
    openIssues: (data.open_issues_count as number) ?? 0,
    archived: (data.archived as boolean) ?? false,
    defaultBranch: (data.default_branch as string) ?? 'main',
    createdAt: data.created_at as string,
    updatedAt: data.updated_at as string,
    pushedAt: data.pushed_at as string,
    topics: (data.topics as string[]) ?? [],
    htmlUrl: data.html_url as string,
  }
}

function mapIssue(data: Record<string, unknown>): IssueInfo {
  return {
    githubId: data.id as number,
    number: data.number as number,
    title: data.title as string,
    body: (data.body as string) ?? null,
    state: data.state as 'open' | 'closed',
    labels: ((data.labels as Array<{ name?: string }>) ?? []).map(l => l.name ?? ''),
    assignees: ((data.assignees as Array<{ login: string }>) ?? []).map(a => a.login),
    comments: (data.comments as number) ?? 0,
    createdAt: data.created_at as string,
    updatedAt: data.updated_at as string,
    htmlUrl: data.html_url as string,
  }
}
