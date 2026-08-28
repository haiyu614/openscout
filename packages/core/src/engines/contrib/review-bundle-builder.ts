/**
 * ReviewBundleBuilder — 贡献包构建器（纯逻辑）。
 *
 * 把 Agent 的代码工作产出（diff + 变更文件 + 验证结果 + 自然语言总结）整合成
 * 一份可审阅的 ReviewBundle：规范化 PR 标题/正文、提取风险点、汇总验证。
 * 不接触任何宿主能力；所有输入来自调用方（Orchestrator）。
 */

import { ReviewBundle } from '../../models/review-bundle.js'
import type { CodeWorkResult, ValidationResult } from '../../ports/agent.js'

/** 构建贡献包所需的上下文（来自 Orchestrator 编排层）。 */
export interface BuildContext {
  /** 关联仓库 owner/name，用于 PR 文案定位 */
  repository: { owner: string; name: string }
  /** 目标 Issue（若有） */
  issue?: { number: number; title: string; url: string }
  /** 贡献分支名 */
  branchName: string
  /** 规范化贡献意图（来自任务/用户指令） */
  intent: string
  /** Agent 产出的 diff（unified format） */
  diff: string
  /** 变更的文件列表 */
  changedFiles: string[]
  /** Agent 执行的验证结果 */
  validations: ValidationResult[]
  /** Agent 的自然语言总结 */
  summary: string
  /** 生成时间（ISO） */
  generatedAt: string
  /** 当前版本号 */
  version: number
}

/** Agent 结果中可能缺失的宽容解析：保证产物不崩溃。 */
function safeChangedFiles(result: CodeWorkResult | undefined, ctx: BuildContext): string[] {
  if (ctx.changedFiles.length > 0) return ctx.changedFiles
  return result?.changedFiles ?? []
}

function buildPrTitle(ctx: BuildContext): string {
  const issueRef = ctx.issue ? ` (#${ctx.issue.number})` : ''
  const base = ctx.intent.trim().replace(/\s+/g, ' ').slice(0, 70)
  return `OpenScout: ${base}${issueRef}`
}

function buildPrBody(ctx: BuildContext): string {
  const lines: string[] = []
  lines.push('## 概述')
  lines.push(ctx.intent.trim())
  if (ctx.issue) {
    lines.push('')
    lines.push(`关联 Issue: ${ctx.issue.url}`)
  }
  lines.push('')
  lines.push('## 变更摘要')
  lines.push(ctx.summary.trim() || '(无摘要)')
  const failed = ctx.validations.filter(v => !v.passed)
  if (failed.length > 0) {
    lines.push('')
    lines.push('## 验证')
    lines.push(`- 已通过: ${ctx.validations.length - failed.length}/${ctx.validations.length}`)
    for (const v of failed) {
      lines.push(`- ❌ \`${v.command}\`${v.error ? `: ${v.error}` : ''}`)
    }
  }
  lines.push('')
  lines.push('---')
  lines.push('_由 OpenScout 自动生成，待人工审阅后发布。_')
  return lines.join('\n')
}

function buildCommitMessage(ctx: BuildContext): string {
  const scope = ctx.issue ? ` (fix #${ctx.issue.number})` : ''
  return `${ctx.intent.trim().replace(/\s+/g, ' ').slice(0, 60)}${scope}`
}

function extractRisks(ctx: BuildContext): string[] {
  const risks: string[] = []
  const failed = ctx.validations.filter(v => !v.passed)
  if (failed.length > 0) {
    risks.push(`${failed.length} 项验证未通过，发布前需人工确认`)
  }
  if (ctx.changedFiles.length > 10) {
    risks.push(`改动文件较多（${ctx.changedFiles.length} 个），建议分段审阅`)
  }
  if (ctx.diff.length > 20000) {
    risks.push('diff 体积较大，可能存在隐藏的副作用')
  }
  return risks
}

/**
 * 构建一份 ReviewBundle。
 * @param ctx - 构建上下文（来自编排层）
 * @param agentResult - 可选的 Agent 原始结果，用于回填缺省字段
 * @returns 规范化后的审阅包
 */
export function buildReviewBundle(
  ctx: BuildContext,
  agentResult?: CodeWorkResult,
): ReviewBundle {
  const changedFiles = safeChangedFiles(agentResult, ctx)
  const passed = ctx.validations.filter(v => v.passed)
  const skipped = ctx.validations
    .filter(v => !v.passed)
    .map(v => `${v.command}: ${v.error ?? '未通过'}`)

  return ReviewBundle.parse({
    version: ctx.version,
    diff: ctx.diff,
    summary: ctx.summary.trim() || (agentResult?.summary ?? ''),
    risks: extractRisks({ ...ctx, changedFiles }),
    commitMessage: buildCommitMessage(ctx),
    prTitle: buildPrTitle(ctx),
    prBody: buildPrBody(ctx),
    validations: passed.map(v => ({
      name: v.command,
      passed: true,
      output: v.output,
    })),
    skippedValidations: skipped,
    changedFiles,
    generatedAt: ctx.generatedAt,
  })
}
