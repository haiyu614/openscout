import { describe, it, expect } from 'vitest'
import { TaskEngine } from '../src/engines/task.js'
import { InMemoryStorage, fixedClock } from './mocks.js'
import type { TaskRecord } from '../src/models/task.js'

const NOW = '2024-06-15T00:00:00Z'

function makeTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'task_1',
    name: 'demo',
    status: 'active',
    repositories: [{ owner: 'octocat', name: 'hello', githubId: 100 }],
    filters: {},
    schedule: { cron: '@every 1h', timezone: 'Asia/Shanghai' },
    quotas: { maxIssuesPerRun: 5, maxPRsPerRun: 2, maxConcurrent: 1, maxPRsPerDay: 3 },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

describe('TaskEngine CRUD', () => {
  it('createTask 写入 draft 并生成 id', () => {
    const storage = new InMemoryStorage()
    const engine = new TaskEngine({ storage, clock: fixedClock(NOW) })
    const t = engine.createTask({ name: 't', repositories: [], schedule: { cron: '@every 1h', timezone: 'UTC' }, quotas: { maxIssuesPerRun: 1, maxPRsPerRun: 1, maxConcurrent: 1 } })
    expect(t.status).toBe('draft')
    expect(t.id).toMatch(/^task_/)
    expect(engine.getTask(t.id)?.id).toBe(t.id)
  })

  it('listTasks 返回全部', () => {
    const storage = new InMemoryStorage()
    const engine = new TaskEngine({ storage, clock: fixedClock(NOW) })
    engine.createTask({ name: 'a', repositories: [], schedule: { cron: '@every 1h', timezone: 'UTC' }, quotas: { maxIssuesPerRun: 1, maxPRsPerRun: 1, maxConcurrent: 1 } })
    engine.createTask({ name: 'b', repositories: [], schedule: { cron: '@every 1h', timezone: 'UTC' }, quotas: { maxIssuesPerRun: 1, maxPRsPerRun: 1, maxConcurrent: 1 } })
    expect(engine.listTasks().length).toBe(2)
  })

  it('状态流转：draft→active→paused→active→stopped', async () => {
    const storage = new InMemoryStorage()
    const engine = new TaskEngine({ storage, clock: fixedClock(NOW) })
    const t = engine.createTask({ name: 't', repositories: [], schedule: { cron: '@every 1h', timezone: 'UTC' }, quotas: { maxIssuesPerRun: 1, maxPRsPerRun: 1, maxConcurrent: 1 } })
    expect((await engine.activate(t.id)).status).toBe('active')
    expect((await engine.pause(t.id)).status).toBe('paused')
    expect((await engine.resume(t.id)).status).toBe('active')
    expect((await engine.stop(t.id)).status).toBe('stopped')
  })

  it('markError 保留 errorMessage', async () => {
    const storage = new InMemoryStorage()
    const engine = new TaskEngine({ storage, clock: fixedClock(NOW) })
    const t = engine.createTask({ name: 't', repositories: [], schedule: { cron: '@every 1h', timezone: 'UTC' }, quotas: { maxIssuesPerRun: 1, maxPRsPerRun: 1, maxConcurrent: 1 } })
    const err = await engine.markError(t.id, 'boom')
    expect(err.status).toBe('error')
    expect(err.errorMessage).toBe('boom')
  })
})

describe('TaskEngine 配额', () => {
  it('达到每日上限后 checkQuota 拒绝', async () => {
    const storage = new InMemoryStorage()
    const engine = new TaskEngine({ storage, clock: fixedClock(NOW) })
    const t = makeTask()
    await storage.tasks.put(t.id, t)
    await engine.recordPRs(t.id, 3, new Date(NOW))
    const check = engine.checkQuota(t.id, new Date(NOW))
    expect(check.allowed).toBe(false)
    expect(check.reason).toContain('每日')
  })

  it('未达上限允许', async () => {
    const storage = new InMemoryStorage()
    const engine = new TaskEngine({ storage, clock: fixedClock(NOW) })
    const t = makeTask()
    await storage.tasks.put(t.id, t)
    await engine.recordPRs(t.id, 1, new Date(NOW))
    expect(engine.checkQuota(t.id, new Date(NOW)).allowed).toBe(true)
  })
})

describe('TaskEngine 水位', () => {
  it('setWatermark 写入并刷新 lastRunAt', async () => {
    const storage = new InMemoryStorage()
    const engine = new TaskEngine({ storage, clock: fixedClock(NOW) })
    const t = makeTask()
    await storage.tasks.put(t.id, t)
    await engine.setWatermark(t.id, '2024-06-16T00:00:00Z')
    expect(engine.getWatermark(t.id)).toBe('2024-06-16T00:00:00Z')
    expect(engine.getTask(t.id)!.lastRunAt).toBeTruthy()
  })
})
