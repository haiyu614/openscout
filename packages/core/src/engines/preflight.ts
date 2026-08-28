/**
 * ContributionPreflight — Issue 可行性预检（纯逻辑）
 *
 * 负责「这个 Issue 是否值得/可以贡献」的评估，与远端事实（关联 PR、
 * 已有分支等）无关的部分。远端事实检查在 DedupEngine / PublishEngine。
 *
 * 评估维度（对应定位文档 §6.2 与 Candidate Ranker 要求）：
 *  - 是否已被认领（assignees）
 *  - 是否标记为适合新贡献者（good first issue 等）
 *  - 是否过旧（stale）
 *  - 讨论热度（没人讨论=无竞争 / 过热=可能有争议）
 */

import type { IssueInfo } from '../ports/github.js'
import type { RankerConfig } from './ranker.js'
import { defaultRankerConfig } from './ranker.js'

export type Feasibility = 'high' | 'medium' | 'low'

export interface FeasibilityAssessment {
  feasibility: Feasibility
  reasons: string[]
  blockers: string[]
}

export interface FeasibilityOptions extends Partial<RankerConfig> {
  /** 当前时间（用于过旧判定），默认取系统时间。测试可注入固定时间。 */
  now?: Date
}

/**
 * 评估单个 Issue 的可贡献性。纯函数，不访问任何外部系统。
 */
export function assessIssueFeasibility(
  issue: IssueInfo,
  options: FeasibilityOptions = {},
): FeasibilityAssessment {
  const { now = new Date(), ...config } = options
  const cfg = { ...defaultRankerConfig, ...config }
  const reasons: string[] = []
  const blockers: string[] = []

  // 已被认领 → 阻塞
  if (issue.assignees.length > 0) {
    blockers.push(`已被 ${issue.assignees.join(', ')} 认领`)
  }

  // 适合新贡献者标签
  const hasEasyLabel = issue.labels.some(l =>
    cfg.easyLabels.some(el => l.toLowerCase().includes(el)),
  )
  if (hasEasyLabel) {
    reasons.push('标记为适合新贡献者')
  }

  // 过旧
  if (issue.createdAt) {
    const ageDays = (now.getTime() - new Date(issue.createdAt).getTime()) / (1000 * 60 * 60 * 24)
    if (ageDays > cfg.staleIssueDays) {
      blockers.push(`创建超过 ${cfg.staleIssueDays} 天，可能已过时`)
    }
  }

  // 讨论热度（无人讨论=无竞争，仅在未被认领时有意义）
  if (issue.assignees.length === 0 && issue.comments === 0) {
    reasons.push('无人讨论，可能无竞争')
  } else if (issue.comments > cfg.hotIssueComments) {
    blockers.push(`讨论过多（${issue.comments} 条），可能有争议或已在进行`)
  }

  let feasibility: Feasibility
  if (blockers.length > 0) {
    feasibility = 'low'
  } else if (reasons.length > 0) {
    feasibility = 'high'
  } else {
    feasibility = 'medium'
  }

  return { feasibility, reasons, blockers }
}
