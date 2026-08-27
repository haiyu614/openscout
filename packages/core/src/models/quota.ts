/**
 * QuotaWindow 数据模型 — 配额窗口
 */
import { z } from 'zod'

export const QuotaWindowRecord = z.object({
  /** 任务 ID */
  taskId: z.string(),
  /** 窗口键："daily:2024-01-15" / "weekly:2024-W03" / "run:{runId}" */
  windowKey: z.string(),
  /** 已使用配额 */
  used: z.number(),
  /** 配额上限 */
  limit: z.number(),
})
export type QuotaWindowRecord = z.infer<typeof QuotaWindowRecord>

/** 生成配额窗口 key */
export function quotaWindowKey(taskId: string, windowType: 'daily' | 'weekly' | 'run', windowId: string): string {
  return `${taskId}:${windowType}:${windowId}`
}
