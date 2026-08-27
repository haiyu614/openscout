/**
 * ReviewBundle 数据模型 — 本地贡献包（审阅材料）
 */
import { z } from 'zod'

export const ReviewBundle = z.object({
  /** 版本号 */
  version: z.number(),
  /** diff（unified format） */
  diff: z.string(),
  /** 变更摘要 */
  summary: z.string(),
  /** 风险说明 */
  risks: z.array(z.string()),
  /** 提交信息建议 */
  commitMessage: z.string(),
  /** PR 标题 */
  prTitle: z.string(),
  /** PR 正文 */
  prBody: z.string(),
  /** 已执行验证 */
  validations: z.array(z.object({
    name: z.string(),
    passed: z.boolean(),
    output: z.string().optional(),
  })),
  /** 未能执行的验证项 */
  skippedValidations: z.array(z.string()),
  /** 变更的文件列表 */
  changedFiles: z.array(z.string()),
  /** 生成时间 */
  generatedAt: z.string(),
})
export type ReviewBundle = z.infer<typeof ReviewBundle>
