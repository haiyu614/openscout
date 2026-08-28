/**
 * search_repos / search_issues 工具测试（闭环编排验证）。
 *
 * 打桩 DSH tools.defineTool，提供内存 GitHubPort，断言：
 *  - 工具被注册（defineTool 调用）；
 *  - search_repos 调用 Core SearchEngine.searchRepositories 并透出可解释结果；
 *  - search_issues 调用 searchIssues 并透出可行性/理由/阻塞项。
 * 核心评分逻辑由 core 的 ranker 测试覆盖，此处只验证适配器编排不重复这些逻辑。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

interface CapturedTool {
  name: string
  description: string
  parameters: unknown
  output: unknown
  timeoutMs?: number
  execute: (args: unknown, exec: { signal: AbortSignal }) => Promise<unknown>
}

const captured: CapturedTool[] = []

vi.mock('@deepseek-ai/dsh-tools', () => ({
  defineTool: (def: CapturedTool) => {
    captured.push(def)
    return def
  },
}))

import { SearchEngine } from '@openscout/core'
import type { GitHubPort, RepoSearchQuery, RepoSearchResult, IssueSearchQuery, IssueSearchResult, RepositoryInfo, IssueInfo } from '@openscout/core'
import { registerSearchTools } from '../src/tools.js'

// 内存 GitHubPort：返回可预测结果，便于断言编排。
class FakeGitHub implements GitHubPort {
  async searchRepositories(_q: RepoSearchQuery): Promise<RepoSearchResult> {
    const repo: RepositoryInfo = {
      id: 1, fullName: 'owner/demo', owner: 'owner', name: 'demo',
      description: 'demo repo', url: '', htmlUrl: '', stars: 100, forks: 5,
      openIssues: 10, language: 'TypeScript', topics: [], license: 'MIT',
      createdAt: '', updatedAt: '', pushedAt: '', archived: false,
    }
    return {
      totalCount: 1, query: _q.keywords ?? '',
      items: [{ fullName: 'owner/demo', stars: 100, description: 'demo repo', language: 'TypeScript', topics: [], license: 'MIT', url: '', htmlUrl: '' }],
    }
  }
  async searchIssues(_q: IssueSearchQuery): Promise<IssueSearchResult> {
    const issue: IssueInfo = {
      id: 1, number: 42, title: 'Add tests', htmlUrl: 'https://github.com/owner/demo/issues/42',
      state: 'open', createdAt: new Date('2024-01-01').toISOString(), updatedAt: new Date('2024-02-01').toISOString(),
      labels: [], comments: 0, assignees: [], author: 'u', isPullRequest: false,
      body: '', closedAt: null,
    }
    return { totalCount: 1, query: '', items: [issue] }
  }
  // 其余方法测试用不到，提供桩实现。
  async getRepository(_o: string, _n: string): Promise<RepositoryInfo> { throw new Error('unused') }
  async getIssue(_o: string, _n: string, _num: number): Promise<IssueInfo> { throw new Error('unused') }
  async getIssueDetail(_o: string, _n: string, _num: number): Promise<IssueInfo> { throw new Error('unused') }
  async getTimeline(_o: string, _n: string, _num: number): Promise<unknown[]> { return [] }
  async getForks(_o: string, _n: string): Promise<unknown[]> { return [] }
  async createFork(_o: string, _n: string): Promise<unknown> { throw new Error('unused') }
  async createBranch(_o: string, _n: string, _from: string, _to: string): Promise<void> { throw new Error('unused') }
  async getFileContent(_o: string, _n: string, _p: string, _ref?: string): Promise<string> { throw new Error('unused') }
  async listDirectory(_o: string, _n: string, _p: string, _ref?: string): Promise<unknown[]> { return [] }
  async createPullRequest(_o: string, _n: string, _p: unknown): Promise<unknown> { throw new Error('unused') }
  async getPullRequest(_o: string, _n: string, _num: number): Promise<unknown> { throw new Error('unused') }
  async getIssuesAssignedToUser(_o: string, _u: string, _state?: string): Promise<IssueInfo[]> { return [] }
  async getOpenPRsAuthoredByUser(_o: string, _u: string): Promise<unknown[]> { return [] }
  async addIssueComment(_o: string, _n: string, _num: number, _body: string): Promise<void> { throw new Error('unused') }
  async createIssue(_o: string, _n: string, _title: string, _body: string, _labels?: string[]): Promise<IssueInfo> { throw new Error('unused') }
}

describe('search tools', () => {
  beforeEach(() => { captured.length = 0 })

  it('registers exactly two tools', () => {
    const engine = new SearchEngine(new FakeGitHub(), { now: () => new Date(0) })
    const disposers = registerSearchTools(engine, () => () => {})
    expect(captured.map(c => c.name).sort()).toEqual(['search_issues', 'search_repos'])
    expect(disposers).toHaveLength(2)
  })

  it('search_repos projects explainable candidates', async () => {
    const engine = new SearchEngine(new FakeGitHub(), { now: () => new Date(0) })
    registerSearchTools(engine, () => () => {})
    const repos = captured.find(c => c.name === 'search_repos')!
    const out = await repos.execute({ query: 'test runner', limit: 5 }, { signal: new AbortController().signal })
    const o = out as any
    expect(o.totalFound).toBe(1)
    expect(o.candidates[0]).toMatchObject({ fullName: 'owner/demo', score: expect.any(Number) })
    expect(Array.isArray(o.candidates[0].matchReasons)).toBe(true)
  })

  it('search_issues projects feasibility/reasons/blockers', async () => {
    const engine = new SearchEngine(new FakeGitHub(), { now: () => new Date() })
    registerSearchTools(engine, () => () => {})
    const issues = captured.find(c => c.name === 'search_issues')!
    const out = await issues.execute({ owner: 'owner', name: 'demo', limit: 5 }, { signal: new AbortController().signal })
    const o = out as any
    expect(o.candidates[0]).toMatchObject({
      number: 42,
      feasibility: expect.any(String),
      reasons: expect.any(Array),
      blockers: expect.any(Array),
    })
  })
})
