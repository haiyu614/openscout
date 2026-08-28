/**
 * PRWorkItem 数据模型 — 从 Issue 到远端 PR 的完整生命周期
 */
import { z } from 'zod'
import { ReviewBundle } from './review-bundle.js'

export const PRWorkItemStatus = z.enum([
  'candidate',    // 候选，待生成
  'generating',   // 正在生成贡献包
  'review',       // 等待用户审阅
  'approved',     // 用户已批准当前版本
  'publishing',   // 正在发布到 GitHub
  'published',    // 已创建远端 PR
  'revising',     // 远端 PR 创建后继续修改
  'discarded',    // 用户删除（本地草案）
  'closed',       // 远端 PR 已关闭
  'failed',       // 生成或发布失败
])
export type PRWorkItemStatus = z.infer<typeof PRWorkItemStatus>

export const PRWorkItemRepository = z.object({
  owner: z.string(),
  name: z.string(),
  githubId: z.number(),
})

export const PRWorkItemIssue = z.object({
  number: z.number(),
  githubId: z.number(),
  title: z.string(),
  url: z.string(),
})

export const RemotePR = z.object({
  number: z.number(),
  url: z.string(),
  isDraft: z.boolean(),
})

export const PRWorkItemRecord = z.object({
  id: z.string(),
  /** 所属任务（手动创建的无 task） */
  taskId: z.string().optional(),
  /** 创建此工作项的 TaskRun */
  taskRunId: z.string().optional(),
  repository: PRWorkItemRepository,
  issue: PRWorkItemIssue.optional(),
  status: PRWorkItemStatus,
  /** 当前版本号，每次修改递增 */
  currentVersion: z.number(),
  /** 隔离工作区路径 */
  workspacePath: z.string().optional(),
  /** 贡献分支名 */
  branchName: z.string().optional(),
  /** 已批准的版本号 */
  approvedVersion: z.number().optional(),
  /** 远端 PR 信息 */
  remotePR: RemotePR.optional(),
  /** 关联的会话 ID（多轮对话） */
  sessionId: z.string().optional(),
  /** 规范化贡献意图 */
  contributionIntent: z.string(),
  /** 改动指纹（用于意图去重） */
  changeFingerprint: z.string().optional(),
  /** 最近一次生成的审阅包（待审阅/已批准/已发布时存在） */
  reviewBundle: ReviewBundle.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** 丢弃原因 */
  discardReason: z.string().optional(),
})
export type PRWorkItemRecord = z.infer<typeof PRWorkItemRecord>
