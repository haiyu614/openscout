/**
 * SearchEngine — 仓库发现与 Issue 筛选引擎
 *
 * 纯业务逻辑，通过 GitHubPort 获取数据，通过 ClockPort 获取时间。
 * 不依赖任何框架。
 */

import type { GitHubPort, RepositoryInfo, IssueInfo } from '../ports/github.js'
import type { ClockPort } from '../ports/clock.js'
import { systemClock } from '../ports/clock.js'
import { CandidateRanker, passesRepoHardFilters, feasibilityOrder } from './ranker.js'
import type { Feasibility } from './ranker.js'

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
  private readonly ranker: CandidateRanker

  constructor(
    private readonly github: GitHubPort,
    clock: ClockPort = systemClock,
  ) {
    this.ranker = new CandidateRanker(clock)
  }

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
    const filtered = result.items.filter(repo => passesRepoHardFilters(repo))

    // 评分排序（委托 CandidateRanker）
    const ranked = filtered
      .map(repo => this.ranker.rankRepository(repo))
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

    // 评估每个 Issue 的可贡献性（委托 CandidateRanker）
    const ranked = result.items
      .map(issue => this.ranker.rankIssue(issue))
      .sort((a, b) => feasibilityOrder[b.feasibility] - feasibilityOrder[a.feasibility])
      .slice(0, limit)

    return {
      candidates: ranked,
      totalFound: result.totalCount,
    }
  }
}
