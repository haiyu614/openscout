/**
 * Task 数据模型 — 定时扫描任务
 */
import { z } from 'zod'

export const TaskStatus = z.enum(['draft', 'active', 'paused', 'stopped', 'error'])
export type TaskStatus = z.infer<typeof TaskStatus>

export const TaskRepository = z.object({
  owner: z.string(),
  name: z.string(),
  githubId: z.number(),
})
export type TaskRepository = z.infer<typeof TaskRepository>

export const TaskFilters = z.object({
  labels: z.array(z.string()).optional(),
  keywords: z.array(z.string()).optional(),
  languages: z.array(z.string()).optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
  /** Issue 最大年龄（天） */
  maxAgeDays: z.number().positive().optional(),
  /** 排除的 Issue 标签 */
  excludeLabels: z.array(z.string()).optional(),
})
export type TaskFilters = z.infer<typeof TaskFilters>

export const TaskSchedule = z.object({
  /** Cron 表达式或固定间隔秒数 */
  cron: z.string(),
  /** IANA 时区 */
  timezone: z.string(),
})
export type TaskSchedule = z.infer<typeof TaskSchedule>

export const TaskQuotas = z.object({
  /** 每次运行最多扫描 Issue 数 */
  maxIssuesPerRun: z.number().positive(),
  /** 每次运行最多生成 PR 草案数 */
  maxPRsPerRun: z.number().positive(),
  /** 每天最多生成 PR 草案数 */
  maxPRsPerDay: z.number().positive().optional(),
  /** 每周最多生成 PR 草案数 */
  maxPRsPerWeek: z.number().positive().optional(),
  /** 最大并发生成数 */
  maxConcurrent: z.number().positive(),
})
export type TaskQuotas = z.infer<typeof TaskQuotas>

export const TaskRecord = z.object({
  id: z.string(),
  name: z.string(),
  status: TaskStatus,
  repositories: z.array(TaskRepository),
  filters: TaskFilters,
  schedule: TaskSchedule,
  quotas: TaskQuotas,
  /** 上次成功扫描的水位（ISO 时间戳） */
  scanWatermark: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastRunAt: z.string().optional(),
  errorMessage: z.string().optional(),
})
export type TaskRecord = z.infer<typeof TaskRecord>
