import { describe, it, expect, vi } from 'vitest'
import { SchedulerEngine } from '../src/engines/scheduler.js'
import { TaskEngine } from '../src/engines/task.js'
import { InMemoryStorage, fixedClock } from './mocks.js'
import type { SchedulerPort, CancelFn } from '../src/ports/scheduler.js'

const NOW = '2024-06-15T00:00:00Z'

// 受控的 Mock SchedulerPort：收集注册的回调，可手动触发
function makeScheduler(): { scheduler: SchedulerPort; fires: Array<() => Promise<void>>; cancelCalls: number } {
  const fires: Array<() => Promise<void>> = []
  let cancelCalls = 0
  const scheduler: SchedulerPort = {
    scheduleAt: (_t, cb) => { fires.push(cb); return () => { cancelCalls++ } },
    scheduleAfter: (_ms, cb) => { fires.push(cb); return () => { cancelCalls++ } },
  }
  return { scheduler, fires, get cancelCalls() { return cancelCalls } }
}

describe('SchedulerEngine 排程', () => {
  it('activate 后注册定时器，runHandler 被调用', async () => {
    const storage = new InMemoryStorage()
    const taskEngine = new TaskEngine({ storage, clock: fixedClock(NOW) })
    const { scheduler, fires } = makeScheduler()
    const runHandler = vi.fn(async () => {})
    const engine = new SchedulerEngine({ taskEngine, scheduler, clock: fixedClock(NOW), runHandler })
    const t = taskEngine.createTask({ name: 't', repositories: [], schedule: { cron: '@every 1h', timezone: 'UTC' }, quotas: { maxIssuesPerRun: 1, maxPRsPerRun: 1, maxConcurrent: 1 } })
    await engine.activate(t.id)
    expect(fires.length).toBe(1)
    // 手动触发
    await (fires[0])()
    expect(runHandler).toHaveBeenCalledWith(t.id)
  })

  it('fire 后自动重新排程（持续运行）', async () => {
    const storage = new InMemoryStorage()
    const taskEngine = new TaskEngine({ storage, clock: fixedClock(NOW) })
    const { scheduler, fires } = makeScheduler()
    const runHandler = vi.fn(async () => {})
    const engine = new SchedulerEngine({ taskEngine, scheduler, clock: fixedClock(NOW), runHandler })
    const t = taskEngine.createTask({ name: 't', repositories: [], schedule: { cron: '@every 1h', timezone: 'UTC' }, quotas: { maxIssuesPerRun: 1, maxPRsPerRun: 1, maxConcurrent: 1 } })
    await engine.activate(t.id)
    await (fires[0])()
    expect(fires.length).toBe(2) // 重新排程
  })

  it('runHandler 抛错不中断调度，任务标记 error', async () => {
    const storage = new InMemoryStorage()
    const taskEngine = new TaskEngine({ storage, clock: fixedClock(NOW) })
    const { scheduler, fires } = makeScheduler()
    const runHandler = vi.fn(async () => { throw new Error('fail') })
    const engine = new SchedulerEngine({ taskEngine, scheduler, clock: fixedClock(NOW), runHandler })
    const t = taskEngine.createTask({ name: 't', repositories: [], schedule: { cron: '@every 1h', timezone: 'UTC' }, quotas: { maxIssuesPerRun: 1, maxPRsPerRun: 1, maxConcurrent: 1 } })
    await engine.activate(t.id)
    await (fires[0])()
    expect(taskEngine.getTask(t.id)!.status).toBe('error')
    expect(taskEngine.getTask(t.id)!.errorMessage).toBe('fail')
    expect(fires.length).toBe(2) // 仍重新排程
  })

  it('pause 取消定时并改状态', async () => {
    const storage = new InMemoryStorage()
    const taskEngine = new TaskEngine({ storage, clock: fixedClock(NOW) })
    const { scheduler, fires } = makeScheduler()
    const engine = new SchedulerEngine({ taskEngine, scheduler, clock: fixedClock(NOW), runHandler: async () => {} })
    const t = taskEngine.createTask({ name: 't', repositories: [], schedule: { cron: '@every 1h', timezone: 'UTC' }, quotas: { maxIssuesPerRun: 1, maxPRsPerRun: 1, maxConcurrent: 1 } })
    await engine.activate(t.id)
    await engine.pause(t.id)
    expect(taskEngine.getTask(t.id)!.status).toBe('paused')
    // 触发已注册的回调（仍应安全，因为是旧的）
  })

  it('reconcile 仅为 active 任务排程', () => {
    const storage = new InMemoryStorage()
    const taskEngine = new TaskEngine({ storage, clock: fixedClock(NOW) })
    const { scheduler, fires } = makeScheduler()
    const engine = new SchedulerEngine({ taskEngine, scheduler, clock: fixedClock(NOW), runHandler: async () => {} })
    const a = taskEngine.createTask({ name: 'a', repositories: [], schedule: { cron: '@every 1h', timezone: 'UTC' }, quotas: { maxIssuesPerRun: 1, maxPRsPerRun: 1, maxConcurrent: 1 } })
    const b = taskEngine.createTask({ name: 'b', repositories: [], schedule: { cron: '@every 1h', timezone: 'UTC' }, quotas: { maxIssuesPerRun: 1, maxPRsPerRun: 1, maxConcurrent: 1 } })
    void taskEngine.activate(b.id)
    void taskEngine.stop(a.id) // a 不是 active
    engine.reconcile()
    expect(fires.length).toBe(1)
  })
})
