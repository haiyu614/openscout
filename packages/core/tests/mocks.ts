/**
 * 测试辅助：Mock GitHubPort / 固定时钟 / 工厂函数
 * 所有 Core 单元测试只依赖这些 Mock，不连接真实 GitHub 或 DSH。
 */

import type {
  GitHubPort,
  RepoSearchResult,
  IssueSearchResult,
  RepositoryInfo,
  IssueInfo,
  IssueDetail,
  TimelineEvent,
} from '../src/ports/github.js'
import type { ClockPort } from '../src/ports/clock.js'
import { InMemoryStorage } from '@openscout/storage-memory'

export function fixedClock(iso: string): ClockPort {
  const t = new Date(iso)
  return { now: () => t }
}

let repoSeq = 1
let issueSeq = 1

export function makeRepo(overrides: Partial<RepositoryInfo> = {}): RepositoryInfo {
  const id = overrides.githubId ?? repoSeq++
  return {
    githubId: id,
    owner: 'octocat',
    name: `repo-${id}`,
    fullName: `octocat/repo-${id}`,
    description: 'A sample repository',
    language: 'TypeScript',
    license: 'mit',
    stars: 120,
    forks: 10,
    openIssues: 5,
    archived: false,
    defaultBranch: 'main',
    createdAt: '2022-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    pushedAt: '2024-06-01T00:00:00Z',
    topics: ['cli', 'tool'],
    htmlUrl: `https://github.com/octocat/repo-${id}`,
    ...overrides,
  }
}

export function makeIssue(overrides: Partial<IssueInfo> = {}): IssueInfo {
  const id = overrides.githubId ?? issueSeq++
  return {
    githubId: id,
    number: overrides.number ?? id,
    title: `Issue ${id}`,
    body: 'Some description',
    state: 'open',
    labels: [],
    assignees: [],
    comments: 0,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-06-01T00:00:00Z',
    htmlUrl: `https://github.com/octocat/repo/issues/${id}`,
    ...overrides,
  }
}

export interface MockGithubOptions {
  repoSearch?: Partial<RepoSearchResult>
  issueSearch?: Partial<IssueSearchResult>
  issueDetail?: IssueDetail | null
  timeline?: TimelineEvent[]
  userBranches?: string[]
}

export function makeMockGithub(opts: MockGithubOptions = {}): GitHubPort {
  return {
    async searchRepositories() {
      return {
        totalCount: opts.repoSearch?.totalCount ?? 0,
        items: opts.repoSearch?.items ?? [],
      }
    },
    async searchIssues() {
      return {
        totalCount: opts.issueSearch?.totalCount ?? 0,
        items: opts.issueSearch?.items ?? [],
      }
    },
    async getRepository(owner, name) {
      return makeRepo({ owner, name })
    },
    async getContributingGuide() {
      return null
    },
    async getLicense() {
      return null
    },
    async getIssue() {
      const base = opts.issueDetail ?? makeIssue({ repository: { owner: 'octocat', name: 'repo' } })
      return base as IssueDetail
    },
    async getIssueTimeline() {
      return opts.timeline ?? []
    },
    async forkRepository() {
      return { owner: 'haiyu614', name: 'repo', fullName: 'haiyu614/repo', htmlUrl: '', defaultBranch: 'main' }
    },
    async createBranch() {},
    async pushCommits() {},
    async createPullRequest() {
      return { number: 1, htmlUrl: '', state: 'open' }
    },
    async closePullRequest() {},
    async deleteBranch() {},
    async getUserForks() {
      return (opts.userBranches ?? []).map(b => ({
        owner: 'haiyu614',
        name: 'repo',
        fullName: 'haiyu614/repo',
      }))
    },
    async checkBranchExists() {
      return false
    },
    async getDefaultBranchSha() {
      return 'sha123'
    },
  }
}

export { InMemoryStorage }
