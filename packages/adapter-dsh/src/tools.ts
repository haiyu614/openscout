/**
 * DSH 模型可见工具：search_repos / search_issues。
 *
 * 由 `defineTool` 声明，注册到 `ctx.tools`。工具体只做「参数 → Core SearchEngine
 * → 可解释结果」的编排，核心评分/去重逻辑全部在 @openscout/core，零重复。
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { SearchEngine } from '@openscout/core'
import type { GitHubPort } from '@openscout/core'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

/** 注册两个搜索工具到 DSH，返回各自的卸载函数。 */
export function registerSearchTools(
  search: SearchEngine,
  register: (def: ToolDefinition) => () => void,
): Array<() => void> {
  void search // SearchEngine 实例由闭包捕获于下方 execute；此处仅作为依赖显式声明

  const searchRepos = defineTool({
    name: 'search_repos',
    description:
      '根据自然语言需求在 GitHub 搜索并排序候选开源仓库，返回匹配理由、担忧项与 0-100 评分。',
    parameters: {
      query: { type: 'string', required: true },
      language: { type: 'string' },
      minStars: { type: 'integer' },
      license: { type: 'string' },
      limit: { type: 'integer' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [
        { type: 'text', text: JSON.stringify(value, null, 2) },
      ],
    },
    timeoutMs: 30_000,
    execute: async (args) => {
      const a = args as {
        query: string
        language?: string
        minStars?: number
        license?: string
        limit?: number
      }
      const result = await search.searchRepositories({
        query: a.query,
        language: a.language,
        minStars: a.minStars,
        license: a.license,
        limit: a.limit ?? 10,
      })
      return {
        totalFound: result.totalFound,
        query: result.query,
        candidates: result.candidates.map(c => ({
          fullName: c.repository.fullName,
          stars: c.repository.stars,
          score: c.score,
          matchReasons: c.matchReasons,
          concerns: c.concerns,
        })),
      }
    },
  })

  const searchIssues = defineTool({
    name: 'search_issues',
    description:
      '在指定仓库搜索可贡献的 Issue，给出可贡献性评估（high/medium/low）、理由与阻塞项。',
    parameters: {
      owner: { type: 'string', required: true },
      name: { type: 'string', required: true },
      keywords: { type: 'string' },
      labels: { type: 'string' },
      limit: { type: 'integer' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [
        { type: 'text', text: JSON.stringify(value, null, 2) },
      ],
    },
    timeoutMs: 30_000,
    execute: async (args) => {
      const a = args as {
        owner: string
        name: string
        keywords?: string
        labels?: string
        limit?: number
      }
      const result = await search.searchIssues({
        repository: { owner: a.owner, name: a.name },
        keywords: a.keywords,
        labels: a.labels ? a.labels.split(',').map(s => s.trim()) : undefined,
        limit: a.limit ?? 10,
      })
      return {
        totalFound: result.totalFound,
        candidates: result.candidates.map(c => ({
          number: c.issue.number,
          title: c.issue.title,
          url: c.issue.htmlUrl,
          feasibility: c.feasibility,
          reasons: c.reasons,
          blockers: c.blockers,
        })),
      }
    },
  })

  const disposeRepos = register(searchRepos)
  const disposeIssues = register(searchIssues)
  return [disposeRepos, disposeIssues]
}

