import { describe, it, expect } from 'vitest'
import { SearchEngine } from '../src/engines/search.js'
import { makeMockGithub, makeRepo, makeIssue, fixedClock } from './mocks.js'

const clock = fixedClock('2024-06-15T00:00:00Z')

describe('SearchEngine - 仓库搜索排序', () => {
  it('硬过滤后按评分降序，仅返回 limit 条', async () => {
    const repos = [
      makeRepo({ githubId: 1, name: 'low', stars: 5, pushedAt: '2020-01-01T00:00:00Z', openIssues: 0, license: null }),
      makeRepo({ githubId: 2, name: 'high', stars: 2000, pushedAt: '2024-06-10T00:00:00Z', openIssues: 10, license: 'mit' }),
      makeRepo({ githubId: 3, name: 'mid', stars: 200, pushedAt: '2024-04-01T00:00:00Z', openIssues: 5, license: 'mit' }),
    ]
    const github = makeMockGithub({ repoSearch: { totalCount: 3, items: repos } })
    const engine = new SearchEngine(github, clock)

    const result = await engine.searchRepositories({ query: 'cli', limit: 2 })
    expect(result.candidates.length).toBe(2)
    expect(result.candidates[0].repository.name).toBe('high')
    expect(result.candidates[1].repository.name).toBe('mid')
    expect(result.totalFound).toBe(3)
  })

  it('归档仓库被硬过滤排除（即使评分高）', async () => {
    const repos = [
      makeRepo({ githubId: 1, name: 'archived', archived: true, stars: 9999, pushedAt: '2024-06-10T00:00:00Z' }),
      makeRepo({ githubId: 2, name: 'active', stars: 100, pushedAt: '2024-06-10T00:00:00Z' }),
    ]
    const github = makeMockGithub({ repoSearch: { totalCount: 2, items: repos } })
    const engine = new SearchEngine(github, clock)
    const result = await engine.searchRepositories({ query: 'x', limit: 10 })
    expect(result.candidates.every(c => c.repository.name === 'active')).toBe(true)
  })
})

describe('SearchEngine - Issue 搜索可行性排序', () => {
  it('按可行性 high > medium > low 排序', async () => {
    const issues = [
      makeIssue({ githubId: 1, labels: [], assignees: ['bob'] }), // low
      makeIssue({ githubId: 2, labels: ['good first issue'], assignees: [] }), // high
      makeIssue({ githubId: 3, labels: [], assignees: [] }), // medium
    ]
    const github = makeMockGithub({ issueSearch: { totalCount: 3, items: issues } })
    const engine = new SearchEngine(github, clock)

    const result = await engine.searchIssues({
      repository: { owner: 'octocat', name: 'repo' },
      limit: 10,
    })
    expect(result.candidates[0].feasibility).toBe('high')
    expect(result.candidates[2].feasibility).toBe('low')
  })

  it('使用 limit 截断结果', async () => {
    const issues = Array.from({ length: 5 }, (_, i) => makeIssue({ githubId: 10 + i }))
    const github = makeMockGithub({ issueSearch: { totalCount: 5, items: issues } })
    const engine = new SearchEngine(github, clock)
    const result = await engine.searchIssues({
      repository: { owner: 'o', name: 'r' },
      limit: 3,
    })
    expect(result.candidates.length).toBe(3)
  })
})
