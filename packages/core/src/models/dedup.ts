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
  /** 创建该记录的来源任务 ID（跨任务去重用） */
  taskId: z.string(),
  /** 创建该记录的运行 ID（运行幂等用） */
  runId: z.string().optional(),
  /** 主动贡献的规范化意图指纹（意图去重用，可空） */
  intentFingerprint: z.string().optional(),
  /** 最近更新时间 */
  updatedAt: z.string(),
  createdAt: z.string(),
})
export type DedupRecord = z.infer<typeof DedupRecord>

/** 生成 Issue 主键去重 key */
export function issueDeduplicationKey(repoGithubId: number, issueGithubId: number): string {
  return `${repoGithubId}:${issueGithubId}`
}

/**
 * 规范化主动贡献意图指纹（意图去重）。
 * 组合：仓库 ID + 目标基线 + 规范化意图 + 改动指纹。
 */
export function intentFingerprint(params: {
  repoGithubId: number
  baseline: string
  intent: string
  changeFingerprint: string
}): string {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()
  return [
    params.repoGithubId,
    norm(params.baseline),
    norm(params.intent),
    norm(params.changeFingerprint),
  ].join('|')
}
