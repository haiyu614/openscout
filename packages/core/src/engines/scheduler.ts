/**
 * SchedulerEngine — 定时触发引擎（纯逻辑）
 *
 * 不持有任何定时器实现，只通过 SchedulerPort（宿主注入）注册回调。
 * 职责：根据任务的 cron/@every 表达式，计算下一次触发时间，注册回调；
 * 触发时调用 runHandler，并在 runHandler 完成后再安排下一次。
 *
 * 设计要点：fail-safe。runHandler 抛错不影响下次调度注册；状态为 error 的任务不再排程。
 */

import type { SchedulerPort, CancelFn } from '../ports/scheduler.js'
import type { ClockPort } from '../ports/clock.js'
import { systemClock } from '../ports/clock.js'
import type { TaskEngine } from './task.js'
import { nextOccurrence } from './cron.js'

export interface RunHandler {
  (taskId: string): Promise<void>
}

export interface SchedulerEngineDeps {
  taskEngine: TaskEngine
  scheduler: SchedulerPort
  clock?: ClockPort
  /** 每次触发时回调（实际执行一次扫描）。引擎不直接依赖具体逻辑。 */
  runHandler: RunHandler
}

export class SchedulerEngine {
  private readonly taskEngine: TaskEngine
  private readonly scheduler: SchedulerPort
  private readonly clock: ClockPort
  private readonly runHandler: RunHandler
  /** 每个任务当前的取消函数 */
  private readonly cancels = new Map<string, CancelFn>()

  constructor(deps: SchedulerEngineDeps) {
    this.taskEngine = deps.taskEngine
    this.scheduler = deps.scheduler
    this.clock = deps.clock ?? systemClock
    this.runHandler = deps.runHandler
  }

  /** 对账：根据所有 active 任务注册定时器（启动或重启时调用） */
  reconcile(): void {
    for (const task of this.taskEngine.listTasks()) {
      if (task.status === 'active') this.scheduleTask(task.id)
    }
  }

  /** 为单个任务安排下一次触发；若状态为 paused/stopped 则跳过 */
  scheduleTask(taskId: string): void {
    this.armNext(taskId)
  }

  /** 计算下一次触发并注册回调；仅当状态非 paused/stopped 时生效 */
  private armNext(taskId: string): void {
    this.unschedule(taskId)
    const task = this.taskEngine.getTask(taskId)
    if (!task) return
    if (task.status === 'paused' || task.status === 'stopped') return
    const now = this.clock.now()
    const next = nextOccurrence(task.schedule.cron, now, task.schedule.timezone)
    if (!next) {
      void this.taskEngine.markError(taskId, '无法计算下一次触发时间（cron 无解）')
      return
    }
    const delayMs = Math.max(0, next.getTime() - now.getTime())
    const cancel = this.scheduler.scheduleAfter(delayMs, () => this.onFire(taskId))
    this.cancels.set(taskId, cancel)
  }

  private async onFire(taskId: string): Promise<void> {
    try {
      await this.runHandler(taskId)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // 标记错误但保持调度（cron 持续运行，下次仍触发）
      void this.taskEngine.markError(taskId, msg)
    } finally {
      // 无论成功失败，重新排程（cron 持续运行）
      this.armNext(taskId)
    }
  }

  /** 取消某任务的定时器 */
  unschedule(taskId: string): void {
    const c = this.cancels.get(taskId)
    if (c) { c(); this.cancels.delete(taskId) }
  }

  /** 激活并排程 */
  async activate(taskId: string): Promise<void> {
    await this.taskEngine.activate(taskId)
    this.scheduleTask(taskId)
  }

  /** 暂停并取消排程 */
  async pause(taskId: string): Promise<void> {
    await this.taskEngine.pause(taskId)
    this.unschedule(taskId)
  }

  /** 停止并取消排程 */
  async stop(taskId: string): Promise<void> {
    await this.taskEngine.stop(taskId)
    this.unschedule(taskId)
  }

  /** 全部取消（进程退出时） */
  stopAll(): void {
    for (const id of [...this.cancels.keys()]) this.unschedule(id)
  }
}
