/**
 * CandidateRanker — 候选评分引擎（纯逻辑、可独立单测）
 *
 * 将仓库与 Issue 的「硬过滤 + 可解释评分」从 SearchEngine 中抽离出来，
 * 使排序规则成为可独立测试、可独立复用的纯函数式逻辑。
 *
 * 不依赖任何框架，只依赖 Port 类型与 ClockPort。
 */

import type { RepositoryInfo, IssueInfo } from '../ports/github.js'
import type { ClockPort } from '../ports/clock.js'
import { systemClock } from '../ports/clock.js'
import { assessIssueFeasibility } from './preflight.js'

export type Feasibility = 'high' | 'medium' | 'low'

export interface RankedRepository {
  repository: RepositoryInfo
  /** 匹配理由（正向信号） */
  matchReasons: string[]
  /** 不匹配项（负向信号） */
  concerns: string[]
  /** 综合评分（0-100） */
  score: number
}

export interface RankedIssue {
  issue: IssueInfo
  /** 可贡献性评估 */
  feasibility: Feasibility
  /** 评估理由 */
  reasons: string[]
  /** 潜在阻塞项 */
  blockers: string[]
}

export interface RankerConfig {
  /** 视为「活跃」的更新窗口（天）：小于此值给予满分 */
  recentPushDays: number
  /** 视为「有更新」的次级窗口（天） */
  activePushDays: number
  /** 判定为「适合新贡献者」的标签（大小写不敏感子串匹配） */
  easyLabels: string[]
  /** 超过该天数的 Issue 视为可能过时 */
  staleIssueDays: number
  /** 评论数超过此值视为讨论过热/可能有争议 */
  hotIssueComments: number
}

export const defaultRankerConfig: RankerConfig = {
  recentPushDays: 30,
  activePushDays: 90,
  easyLabels: ['good first issue', 'help wanted', 'easy', 'beginner', 'starter'],
  staleIssueDays: 365,
  hotIssueComments: 20,
}

/** 硬过滤：不通过则直接排除（不参与排序） */
export function passesRepoHardFilters(repo: RepositoryInfo): boolean {
  // 不能已归档
  if (repo.archived) return false
  // 既无描述又极度冷门（星数过低）的不值得关注
  if (!repo.description && repo.stars < 10) return false
  return true
}

export class CandidateRanker {
  private readonly config: RankerConfig

  constructor(
    private readonly clock: ClockPort = systemClock,
    config: Partial<RankerConfig> = {},
  ) {
    this.config = { ...defaultRankerConfig, ...config }
  }

  /** 对仓库进行可解释评分（0-100） */
  rankRepository(repo: RepositoryInfo): RankedRepository {
    let score = 0
    const matchReasons: string[] = []
    const concerns: string[] = []

    // 活跃度评分（基于最后 push 时间）
    const daysSincePush = this.daysSince(repo.pushedAt)
    if (daysSincePush < this.config.recentPushDays) {
      score += 25
      matchReasons.push(`近 ${this.config.recentPushDays} 天内有代码更新`)
    } else if (daysSincePush < this.config.activePushDays) {
      score += 15
      matchReasons.push(`近 ${this.config.activePushDays} 天内有代码更新`)
    } else {
      concerns.push(`最后更新在 ${Math.round(daysSincePush)} 天前`)
    }

    // 社区规模
    if (repo.stars >= 1000) {
      score += 20
      matchReasons.push(`${repo.stars} stars，社区活跃`)
    } else if (repo.stars >= 100) {
      score += 15
      matchReasons.push(`${repo.stars} stars`)
    } else if (repo.stars >= 10) {
      score += 10
    }

    // 有 Issue 意味着可以贡献
    if (repo.openIssues > 0) {
      score += 15
      matchReasons.push(`${repo.openIssues} 个 open issues`)
    } else {
      concerns.push('没有 open issues')
    }

    // 有许可证
    if (repo.license) {
      score += 10
      matchReasons.push(`许可证: ${repo.license}`)
    } else {
      concerns.push('未声明许可证')
    }

    // 有明确的语言
    if (repo.language) {
      score += 5
      matchReasons.push(`主要语言: ${repo.language}`)
    }

    // 有 topics
    if (repo.topics.length > 0) {
      score += 5
    }

    return {
      repository: repo,
      matchReasons,
      concerns,
      score: Math.min(score, 100),
    }
  }

  /** 评估 Issue 的可贡献性（委托给 Preflight，保证规则单一来源） */
  rankIssue(issue: IssueInfo): RankedIssue {
    const { feasibility, reasons, blockers } = assessIssueFeasibility(issue, {
      ...this.config,
      now: this.clock.now(),
    })
    return { issue, feasibility, reasons, blockers }
  }

  private daysSince(isoDate: string): number {
    const then = new Date(isoDate).getTime()
    const now = this.clock.now().getTime()
    return (now - then) / (1000 * 60 * 60 * 24)
  }
}

export const feasibilityOrder: Record<Feasibility, number> = {
  high: 3,
  medium: 2,
  low: 1,
}
