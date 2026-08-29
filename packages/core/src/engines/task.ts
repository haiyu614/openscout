/**
 * TaskEngine — 定时扫描任务引擎（CRUD + 状态流转 + 配额 + 水位）
 *
 * 纯逻辑，仅依赖 StoragePort / ClockPort。任务本身不持有调度定时器，
 * 调度交由 SchedulerEngine；本引擎负责任务的持久化状态与配额约束。
 */

import type { StoragePort, TablePort } from '../ports/storage.js'
import type { ClockPort } from '../ports/clock.js'
import { systemClock } from '../ports/clock.js'
import {
  TaskRecord,
  TaskStatus,
  TaskRepository,
  TaskFilters,
  TaskSchedule,
  TaskQuotas,
} from '../models/task.js'
import { QuotaWindowRecord } from '../models/quota.js'

export interface CreateTaskInput {
  name: string
  repositories: TaskRepository[]
  filters?: TaskFilters
  schedule: TaskSchedule
  quotas: TaskQuotas
}

export interface QuotaCheck {
  allowed: boolean
  reason?: string
  /** 当前已用（达到上限时为 limit） */
  usedDaily?: number
  limitDaily?: number
  usedWeekly?: number
  limitWeekly?: number
}

export interface TaskEngineDeps {
  storage: StoragePort
  clock?: ClockPort
}

export class TaskEngine {
  private readonly taskTable: TablePort<string, unknown>
  private readonly quotaTable: TablePort<string, unknown>
  private readonly clock: ClockPort

  constructor(deps: TaskEngineDeps) {
    this.taskTable = deps.storage.tasks
    this.quotaTable = deps.storage.quotaWindows
    this.clock = deps.clock ?? systemClock
  }

  // ---- CRUD ----

  createTask(input: CreateTaskInput): TaskRecord {
    const nowIso = this.clock.now().toISOString()
    const id = `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    const record: TaskRecord = {
      id,
      name: input.name,
      status: 'draft',
      repositories: input.repositories,
      filters: input.filters ?? {},
      schedule: input.schedule,
      quotas: input.quotas,
      createdAt: nowIso,
      updatedAt: nowIso,
    }
    // 同步写入（TablePort.put 异步，但内存态立即可见；调用方 await）
    void this.taskTable.put(id, record)
    return record
  }

  getTask(id: string): TaskRecord | undefined {
    return this.taskTable.get(id) as TaskRecord | undefined
  }

  listTasks(): TaskRecord[] {
    const out: TaskRecord[] = []
    for (const [, v] of this.taskTable.entries()) out.push(v as TaskRecord)
    return out
  }

  async updateTask(id: string, patch: Partial<Omit<TaskRecord, 'id' | 'createdAt'>>): Promise<TaskRecord> {
    const existing = this.getTask(id)
    if (!existing) throw new Error(`任务不存在: ${id}`)
    const updated: TaskRecord = { ...existing, ...patch, id, createdAt: existing.createdAt, updatedAt: this.clock.now().toISOString() }
    await this.taskTable.put(id, updated)
    return updated
  }

  async deleteTask(id: string): Promise<boolean> {
    return this.taskTable.delete(id)
  }

  // ---- 状态流转（fail-closed，显式允许） ----

  private async transition(id: string, to: TaskStatus): Promise<TaskRecord> {
    return this.updateTask(id, { status: to, errorMessage: undefined })
  }

  /** draft/paused/error → active */
  async activate(id: string): Promise<TaskRecord> {
    return this.transition(id, 'active')
  }
  /** active → paused */
  async pause(id: string): Promise<TaskRecord> {
    return this.transition(id, 'paused')
  }
  /** paused/error → active（恢复） */
  async resume(id: string): Promise<TaskRecord> {
    return this.transition(id, 'active')
  }
  /** active/paused → stopped（终态） */
  async stop(id: string): Promise<TaskRecord> {
    return this.transition(id, 'stopped')
  }
  /** 运行期失败标记 */
  async markError(id: string, message: string): Promise<TaskRecord> {
    return this.updateTask(id, { status: 'error', errorMessage: message })
  }

  // ---- 配额 ----

  private windowKey(taskId: string, type: 'daily' | 'weekly' | 'run', id: string): string {
    // 复用 models/quota.ts 的 key 约定（taskId:type:id）
    return `${taskId}:${type}:${id}`
  }

  private dayKey(d: Date): string {
    return d.toISOString().slice(0, 10) // YYYY-MM-DD
  }
  private weekKey(d: Date): string {
    // ISO 周：年-Www
    const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
    const dayNum = (tmp.getUTCDay() + 6) % 7 // Mon=0
    const thursday = new Date(tmp.getTime() - dayNum * 86_400_000 + 3 * 86_400_000)
    const year = thursday.getUTCFullYear()
    const week = Math.ceil((thursday.getTime() - Date.UTC(year, 0, 1)) / (7 * 86_400_000))
    return `${year}-W${String(week).padStart(2, '0')}`
  }

  /** 检查当前是否允许再发起一次运行（按日/周 PR 配额） */
  checkQuota(taskId: string, now: Date = this.clock.now()): QuotaCheck {
    const task = this.getTask(taskId)
    if (!task) return { allowed: false, reason: '任务不存在' }
    const q = task.quotas
    const dailyKey = this.windowKey(taskId, 'daily', this.dayKey(now))
    const weeklyKey = this.windowKey(taskId, 'weekly', this.weekKey(now))
    const daily = this.quotaTable.get(dailyKey) as QuotaWindowRecord | undefined
    const weekly = this.quotaTable.get(weeklyKey) as QuotaWindowRecord | undefined
    if (q.maxPRsPerDay !== undefined) {
      const used = daily?.used ?? 0
      if (used >= q.maxPRsPerDay) return { allowed: false, reason: '达到每日 PR 配额上限', usedDaily: used, limitDaily: q.maxPRsPerDay }
    }
    if (q.maxPRsPerWeek !== undefined) {
      const used = weekly?.used ?? 0
      if (used >= q.maxPRsPerWeek) return { allowed: false, reason: '达到每周 PR 配额上限', usedWeekly: used, limitWeekly: q.maxPRsPerWeek }
    }
    return { allowed: true }
  }

  /** 运行结束后记录 PR 用量（日/周窗口累加；运行窗口由调用方单独管理） */
  async recordPRs(taskId: string, count: number, now: Date = this.clock.now()): Promise<void> {
    if (count <= 0) return
    const task = this.getTask(taskId)
    if (!task) return
    const q = task.quotas
    const dailyKey = this.windowKey(taskId, 'daily', this.dayKey(now))
    const weeklyKey = this.windowKey(taskId, 'weekly', this.weekKey(now))
    if (q.maxPRsPerDay !== undefined) await this.bumpWindow(dailyKey, count, q.maxPRsPerDay)
    if (q.maxPRsPerWeek !== undefined) await this.bumpWindow(weeklyKey, count, q.maxPRsPerWeek)
  }

  private async bumpWindow(key: string, delta: number, limit: number): Promise<void> {
    const cur = this.quotaTable.get(key) as QuotaWindowRecord | undefined
    const rec: QuotaWindowRecord = cur ?? { taskId: key.split(':')[0], windowKey: key, used: 0, limit }
    await this.quotaTable.put(key, { ...rec, used: rec.used + delta, limit })
  }

  // ---- 水位 ----

  getWatermark(taskId: string): string | undefined {
    return this.getTask(taskId)?.scanWatermark
  }

  async setWatermark(taskId: string, iso: string): Promise<void> {
    await this.updateTask(taskId, { scanWatermark: iso, lastRunAt: this.clock.now().toISOString() })
  }
}
