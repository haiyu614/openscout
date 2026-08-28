import { describe, it, expect } from 'vitest'
import { CandidateRanker, passesRepoHardFilters, feasibilityOrder, defaultRankerConfig } from '../src/engines/ranker.js'
import { assessIssueFeasibility } from '../src/engines/preflight.js'
import { fixedClock, makeRepo, makeIssue } from './mocks.js'

// 固定“今天”为 2024-06-15，使 pushedAt 等相对计算可预测
const clock = fixedClock('2024-06-15T00:00:00Z')

describe('CandidateRanker - 仓库评分', () => {
  it('硬过滤排除归档仓库', () => {
    const repo = makeRepo({ archived: true })
    expect(passesRepoHardFilters(repo)).toBe(false)
  })

  it('硬过滤排除无描述且低星的仓库', () => {
    const repo = makeRepo({ description: null, stars: 3 })
    expect(passesRepoHardFilters(repo)).toBe(false)
  })

  it('有描述且低星的仓库通过硬过滤', () => {
    const repo = makeRepo({ description: 'x', stars: 3 })
    expect(passesRepoHardFilters(repo)).toBe(true)
  })

  it('近期更新的仓库获得活跃度满分', () => {
    const repo = makeRepo({ pushedAt: '2024-06-10T00:00:00Z' }) // 5 天前
    const ranker = new CandidateRanker(clock)
    const ranked = ranker.rankRepository(repo)
    expect(ranked.score).toBeGreaterThanOrEqual(25)
    expect(ranked.matchReasons.some(r => r.includes('天内有代码更新'))).toBe(true)
  })

  it('长期未更新的仓库计入 concerns', () => {
    const repo = makeRepo({ pushedAt: '2020-01-01T00:00:00Z' })
    const ranker = new CandidateRanker(clock)
    const ranked = ranker.rankRepository(repo)
    expect(ranked.concerns.some(c => c.includes('最后更新'))).toBe(true)
    // 没有近期更新加分（< 25），但社区规模等仍可能给分
    expect(ranked.score).toBeLessThan(25 + 15 + 15 + 10)
  })

  it('千星仓库获得社区规模加分', () => {
    const ranker = new CandidateRanker(clock)
    const ranked = ranker.rankRepository(makeRepo({ stars: 1500 }))
    expect(ranked.score).toBeGreaterThanOrEqual(45) // 25 + 20
  })

  it('有许可证与 topics 累加分数上限封顶 100', () => {
    const ranker = new CandidateRanker(clock)
    const ranked = ranker.rankRepository(
      makeRepo({
        pushedAt: '2024-06-10T00:00:00Z',
        stars: 5000,
        openIssues: 30,
        license: 'mit',
        language: 'TS',
        topics: ['a', 'b'],
      }),
    )
    expect(ranked.score).toBeLessThanOrEqual(100)
  })
})

describe('CandidateRanker / Preflight - Issue 可行性', () => {
  it('good first issue 且无人认领 → high', () => {
    const issue = makeIssue({ labels: ['good first issue'], assignees: [] })
    const res = assessIssueFeasibility(issue, { now: fixedClock('2024-06-15T00:00:00Z').now() })
    expect(res.feasibility).toBe('high')
  })

  it('已被认领 → low（阻塞）', () => {
    const issue = makeIssue({ assignees: ['alice'], labels: ['good first issue'] })
    const res = assessIssueFeasibility(issue, { now: fixedClock('2024-06-15T00:00:00Z').now() })
    expect(res.feasibility).toBe('low')
    expect(res.blockers.some(b => b.includes('认领'))).toBe(true)
  })

  it('创建超过一年 → 可能过时（阻塞）', () => {
    const issue = makeIssue({ createdAt: '2022-01-01T00:00:00Z', labels: ['good first issue'] })
    const res = assessIssueFeasibility(issue, { now: fixedClock('2024-06-15T00:00:00Z').now(), staleIssueDays: 365 })
    expect(res.blockers.some(b => b.includes('过时'))).toBe(true)
  })

  it('讨论过热（评论过多）→ low', () => {
    const issue = makeIssue({ comments: 50, labels: ['good first issue'] })
    const res = assessIssueFeasibility(issue, { now: fixedClock('2024-06-15T00:00:00Z').now(), hotIssueComments: 20 })
    expect(res.feasibility).toBe('low')
    expect(res.blockers.some(b => b.includes('讨论过多'))).toBe(true)
  })

  it('无人讨论 → 无竞争（正向理由）', () => {
    const issue = makeIssue({ comments: 0, labels: ['help wanted'] })
    const res = assessIssueFeasibility(issue, { now: fixedClock('2024-06-15T00:00:00Z').now() })
    expect(res.reasons.some(r => r.includes('无竞争'))).toBe(true)
  })

  it('rankIssue 委托 preflight 并产出 RankedIssue', () => {
    const ranker = new CandidateRanker(clock)
    const ranked = ranker.rankIssue(makeIssue({ labels: ['good first issue'] }))
    expect(ranked.issue).toBeDefined()
    expect(ranked.feasibility).toBe('high')
  })

  it('feasibilityOrder 排序权重正确', () => {
    expect(feasibilityOrder.high).toBeGreaterThan(feasibilityOrder.medium)
    expect(feasibilityOrder.medium).toBeGreaterThan(feasibilityOrder.low)
  })

  it('默认配置常量存在', () => {
    expect(defaultRankerConfig.easyLabels.length).toBeGreaterThan(0)
  })
})
