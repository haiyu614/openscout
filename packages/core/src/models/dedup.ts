/**
 * Dedup 数据模型 — 去重注册表
 */
import { z } from 'zod'

export const DedupStatus = z.enum(['active', 'tombstone'])
export type DedupStatus = z.infer<typeof DedupStatus>

export const DedupRecord = z.object({
  /** 去重键："{repoGithubId}:{issueGithubId}" 或意图指纹 */
  key: z.string(),
  /** 关联的 PR 工作项 ID */
  workItemId: z.string(),
  /** 状态 */
  status: DedupStatus,
  /** 墓碑原因（用户删除/拒绝/已关闭等） */
  tombstoneReason: z.string().optional(),
  /** 墓碑时间 */
  tombstoneAt: z.string().optional(),
  createdAt: z.string(),
})
export type DedupRecord = z.infer<typeof DedupRecord>

/** 生成 Issue 主键去重 key */
export function issueDeduplicationKey(repoGithubId: number, issueGithubId: number): string {
  return `${repoGithubId}:${issueGithubId}`
}
