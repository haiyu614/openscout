import { describe, it, expect, vi } from 'vitest'
import { ScanOrchestrator } from '../src/engines/scan.js'
import { TaskEngine } from '../src/engines/task.js'
import { InMemoryStorage, fixedClock, makeRepo, makeIssue } from './mocks.js'
import type { TaskRecord } from '../src/models/task.js'

const NOW = '2024-06-15T00:00:00Z'

function makeTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'task_1',
    name: 'demo',
    status: 'active',
    repositories: [{ owner: 'octocat', name: 'hello', githubId: 100 }],
    filters: {},
    schedule: { cron: '@every 1h', timezone: 'UTC' },
    quotas: { maxIssuesPerRun: 5, maxPRsPerRun: 2, maxConcurrent: 1 },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

interface Ctx {
  storage: InMemoryStorage
  taskEngine: TaskEngine
  search: { searchIssues: ReturnType<typeof vi.fn> }
  dedup: { check: ReturnType<typeof vi.fn> }
  orchestrator: { generate: ReturnType<typeof vi.fn> }
}

function setup(issues: Array<{ number: number; feasibility: string }>): Ctx {
  const storage = new InMemoryStorage()
  const taskEngine = new TaskEngine({ storage, clock: fixedClock(NOW) })
  const t = makeTask()
  void storage.tasks.put(t.id, t)
  const search = vi.fn(async () => ({ candidates: issues.map((i) => ({
    issue: { number: i.number, githubId: i.number + 1000, title: `Issue ${i.number}`, htmlUrl: `https://x/${i.number}` },
    feasibility: i.feasibility,
  })) }))
  const dedup = vi.fn(() => ({ duplicate: false }))
  const orchestrator = vi.fn(async () => ({ kind: 'generated', workItem: { id: 'wi_x' } }))
  return { storage, taskEngine, search, dedup, orchestrator }
}

describe('ScanOrchestrator 单次运行', () => {
  it('搜索→去重→生成 全流程，统计指标', async () => {
    const ctx = setup([{ number: 1, feasibility: 'high' }, { number: 2, feasibility: 'medium' }])
    const engine = new ScanOrchestrator({
      storage: ctx.storage, clock: fixedClock(NOW),
      github: {} as any,
      searchEngine: { searchIssues: ctx.search } as any,
      dedupEngine: { check: ctx.dedup } as any,
      orchestrator: { generate: ctx.orchestrator } as any,
      taskEngine: ctx.taskEngine as any,
    })
    const res = await engine.run('task_1')
    expect(res.status).toBe('completed')
    expect(res.issuesScanned).toBe(2)
    expect(res.issuesMatched).toBe(2)
    expect(res.prsGenerated).toBe(2)
    expect(ctx.orchestrator).toHaveBeenCalledTimes(2)
  })

  it('去重命中跳过候选', async () => {
    const ctx = setup([{ number: 1, feasibility: 'high' }])
    ctx.dedup.mockReturnValue({ duplicate: true, reason: '重复' })
    const engine = new ScanOrchestrator({
      storage: ctx.storage, clock: fixedClock(NOW), github: {} as any,
      searchEngine: { searchIssues: ctx.search } as any, dedupEngine: { check: ctx.dedup } as any,
      orchestrator: { generate: ctx.orchestrator } as any, taskEngine: ctx.taskEngine as any,
    })
    const res = await engine.run('task_1')
    expect(res.issuesMatched).toBe(0)
    expect(res.prsGenerated).toBe(0)
    expect(ctx.orchestrator).not.toHaveBeenCalled()
  })

  it('受 maxPRsPerRun 限制停止生成', async () => {
    const ctx = setup([
      { number: 1, feasibility: 'high' },
      { number: 2, feasibility: 'high' },
      { number: 3, feasibility: 'high' },
    ])
    const storage = ctx.storage
    const t = makeTask({ quotas: { maxIssuesPerRun: 5, maxPRsPerRun: 2, maxConcurrent: 1 } })
    await storage.tasks.put('task_1', t)
    const engine = new ScanOrchestrator({
      storage, clock: fixedClock(NOW), github: {} as any,
      searchEngine: { searchIssues: ctx.search } as any, dedupEngine: { check: ctx.dedup } as any,
      orchestrator: { generate: ctx.orchestrator } as any, taskEngine: ctx.taskEngine as any,
    })
    const res = await engine.run('task_1')
    expect(res.prsGenerated).toBe(2) // 上限
    expect(ctx.orchestrator).toHaveBeenCalledTimes(2)
  })

  it('日配额用尽时跳过运行', async () => {
    const ctx = setup([{ number: 1, feasibility: 'high' }])
    const t = makeTask({ quotas: { maxIssuesPerRun: 5, maxPRsPerRun: 2, maxConcurrent: 1, maxPRsPerDay: 1 } })
    await ctx.storage.tasks.put('task_1', t)
    await ctx.taskEngine.recordPRs('task_1', 1, new Date(NOW))
    const engine = new ScanOrchestrator({
      storage: ctx.storage, clock: fixedClock(NOW), github: {} as any,
      searchEngine: { searchIssues: ctx.search } as any, dedupEngine: { check: ctx.dedup } as any,
      orchestrator: { generate: ctx.orchestrator } as any, taskEngine: ctx.taskEngine as any,
    })
    const res = await engine.run('task_1')
    expect(res.issuesScanned).toBe(0)
    expect(res.errorMessage).toContain('每日')
    expect(ctx.search).not.toHaveBeenCalled()
  })

  it('运行后更新水位', async () => {
    const ctx = setup([{ number: 1, feasibility: 'high' }])
    const engine = new ScanOrchestrator({
      storage: ctx.storage, clock: fixedClock(NOW), github: {} as any,
      searchEngine: { searchIssues: ctx.search } as any, dedupEngine: { check: ctx.dedup } as any,
      orchestrator: { generate: ctx.orchestrator } as any, taskEngine: ctx.taskEngine as any,
    })
    const res = await engine.run('task_1')
    expect(res.watermarkAfter).toBeTruthy()
    expect(ctx.taskEngine.getWatermark('task_1')).toBeTruthy()
  })
})
