/**
 * SearchEngine — 仓库发现与 Issue 筛选引擎
 *
 * 纯业务逻辑，通过 GitHubPort 获取数据，通过 ClockPort 获取时间。
 * 不依赖任何框架。
 */

import type { GitHubPort, RepositoryInfo, IssueInfo } from '../ports/github.js'
import type { ClockPort } from '../ports/clock.js'
import { systemClock } from '../ports/clock.js'

export interface SearchReposParams {
  /** 用户的自然语言需求描述 */
  query: string
  /** 编程语言 */
  language?: string
  /** 最少星数 */
  minStars?: number
  /** 许可证 */
  license?: string
  /** 结果数量上限 */
  limit?: number
}

export interface RankedRepository {
  repository: RepositoryInfo
  /** 匹配理由 */
  matchReasons: string[]
  /** 不匹配项 */
  concerns: string[]
  /** 综合评分（0-100） */
  score: number
}

export interface SearchReposResult {
  candidates: RankedRepository[]
  totalFound: number
  query: string
}

export interface SearchIssuesParams {
  /** 目标仓库 */
  repository: { owner: string; name: string }
  /** 搜索关键词 */
  keywords?: string
  /** 标签过滤 */
  labels?: string[]
  /** 最大结果数 */
  limit?: number
  /** 只看指定时间后创建的 Issue */
  createdAfter?: string
}

export interface RankedIssue {
  issue: IssueInfo
  /** 可贡献性评估 */
  feasibility: 'high' | 'medium' | 'low'
  /** 评估理由 */
  reasons: string[]
  /** 潜在阻塞项 */
  blockers: string[]
}

export interface SearchIssuesResult {
  candidates: RankedIssue[]
  totalFound: number
}

export class SearchEngine {
  constructor(
    private readonly github: GitHubPort,
    private readonly clock: ClockPort = systemClock,
  ) {}

  /**
   * 搜索并排序仓库候选
   */
  async searchRepositories(params: SearchReposParams): Promise<SearchReposResult> {
    const { query, language, minStars, license, limit = 20 } = params

    // 构建 GitHub 搜索参数
    const result = await this.github.searchRepositories({
      keywords: query,
      language,
      minStars,
      license,
      sort: 'best-match',
      perPage: Math.min(limit * 2, 100), // 多取一些用于过滤后排序
    })

    // 硬过滤
    const filtered = result.items.filter(repo => this.passesHardFilters(repo))

    // 评分排序
    const ranked = filtered
      .map(repo => this.rankRepository(repo))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)

    return {
      candidates: ranked,
      totalFound: result.totalCount,
      query,
    }
  }

  /**
   * 搜索并评估可贡献的 Issue
   */
  async searchIssues(params: SearchIssuesParams): Promise<SearchIssuesResult> {
    const { repository, keywords, labels, limit = 20, createdAfter } = params

    const result = await this.github.searchIssues({
      repository,
      keywords,
      labels,
      state: 'open',
      sort: 'updated',
      createdAfter,
      perPage: Math.min(limit * 2, 100),
    })

    // 评估每个 Issue 的可贡献性
    const ranked = result.items
      .map(issue => this.rankIssue(issue))
      .sort((a, b) => {
        const feasibilityOrder = { high: 3, medium: 2, low: 1 }
        return feasibilityOrder[b.feasibility] - feasibilityOrder[a.feasibility]
      })
      .slice(0, limit)

    return {
      candidates: ranked,
      totalFound: result.totalCount,
    }
  }

  /** 硬过滤：必须通过的基本条件 */
  private passesHardFilters(repo: RepositoryInfo): boolean {
    // 不能已归档
    if (repo.archived) return false
    // 必须有描述或至少有代码
    if (!repo.description && repo.stars < 10) return false
    return true
  }

  /** 对仓库进行可解释评分 */
  private rankRepository(repo: RepositoryInfo): RankedRepository {
    let score = 0
    const matchReasons: string[] = []
    const concerns: string[] = []

    // 活跃度评分（基于最后 push 时间）
    const daysSincePush = this.daysSince(repo.pushedAt)
    if (daysSincePush < 30) {
      score += 25
      matchReasons.push('近 30 天内有代码更新')
    } else if (daysSincePush < 90) {
      score += 15
      matchReasons.push('近 90 天内有代码更新')
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

    return { repository: repo, matchReasons, concerns, score: Math.min(score, 100) }
  }

  /** 评估 Issue 的可贡献性 */
  private rankIssue(issue: IssueInfo): RankedIssue {
    const reasons: string[] = []
    const blockers: string[] = []

    // 检查是否已被认领
    if (issue.assignees.length > 0) {
      blockers.push(`已被 ${issue.assignees.join(', ')} 认领`)
    }

    // 检查标签
    const easyLabels = ['good first issue', 'help wanted', 'easy', 'beginner', 'starter']
    const hasEasyLabel = issue.labels.some(l =>
      easyLabels.some(el => l.toLowerCase().includes(el)),
    )
    if (hasEasyLabel) {
      reasons.push('标记为适合新贡献者')
    }

    // 检查年龄
    const daysOld = this.daysSince(issue.createdAt)
    if (daysOld > 365) {
      blockers.push('创建超过一年，可能已过时')
    }

    // 检查评论活跃度
    if (issue.comments === 0) {
      reasons.push('无人讨论，可能无竞争')
    } else if (issue.comments > 20) {
      blockers.push('讨论过多，可能有争议或已在进行')
    }

    // 确定可行性
    let feasibility: 'high' | 'medium' | 'low'
    if (blockers.length === 0 && reasons.length > 0) {
      feasibility = 'high'
    } else if (blockers.length > reasons.length) {
      feasibility = 'low'
    } else {
      feasibility = 'medium'
    }

    return { issue, feasibility, reasons, blockers }
  }

  /** 计算距今天数 */
  private daysSince(isoDate: string): number {
    const then = new Date(isoDate).getTime()
    const now = this.clock.now().getTime()
    return (now - then) / (1000 * 60 * 60 * 24)
  }
}
