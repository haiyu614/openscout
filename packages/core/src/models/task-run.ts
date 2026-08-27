/**
 * TaskRun 数据模型 — 一次任务运行
 */
import { z } from 'zod'

export const TaskRunStatus = z.enum([
  'scheduled',
  'running',
  'completed',
  'failed',
  'cancelled',
])
export type TaskRunStatus = z.infer<typeof TaskRunStatus>

export const TaskRunRecord = z.object({
  id: z.string(),
  taskId: z.string(),
  status: TaskRunStatus,
  scheduledAt: z.string(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  /** 本次运行前的水位 */
  watermarkBefore: z.string().optional(),
  /** 本次运行后的水位 */
  watermarkAfter: z.string().optional(),
  /** 扫描的 Issue 数量 */
  issuesScanned: z.number(),
  /** 匹配的 Issue 数量 */
  issuesMatched: z.number(),
  /** 生成的 PR 草案数量 */
  prsGenerated: z.number(),
  /** 本次使用的配额 */
  quotaUsed: z.number(),
  errorMessage: z.string().optional(),
})
export type TaskRunRecord = z.infer<typeof TaskRunRecord>
