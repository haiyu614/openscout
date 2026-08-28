/**
 * ContribOrchestrator — 贡献包生成工作流编排（纯逻辑）。
 *
 * 定义「针对一个合格 Issue 生成可提交贡献包」的端到端流程，但只编排、不实现：
 * 去重查重用 DedupEngine，代码工作委托 AgentPort，审阅包用 ReviewBundleBuilder，
 * 状态流转用 PRWorkflowEngine。所有宿主能力经 Port 注入，Core 零框架依赖。
 *
 * 流程（核心闭环 M3）：
 *   1. 去重判定（checkAll）→ 重复则终止
 *   2. 创建 PRWorkItem（candidate）→ 写存储
 *   3. 委托 Agent 完成代码工作（generating）
 *   4. 构建 ReviewBundle（review）
 *   5. 调用方（Adapter）拿到 review 包后，请求 ApprovalPort；批准再进入发布阶段（M4）
 *
 * 本引擎只负责到「review（待审阅）」为止；发布由 M4 PublishEngine 接管。
 */

import {
  PRWorkItemRecord,
  PRWorkItemStatus,
} from '../../models/pr-work-item.js'
import { DedupEngine, type RemoteFacts } from '../dedup.js'
import type { AgentPort, CodeWorkRequest } from '../../ports/agent.js'
import type { StoragePort, TablePort } from '../../ports/storage.js'
import type { ClockPort } from '../../ports/clock.js'
import { systemClock } from '../../ports/clock.js'
import { issueDeduplicationKey } from '../../models/dedup.js'
import { buildReviewBundle, type BuildContext } from './review-bundle-builder.js'
import { transition, canReset, type TransitionResult } from './pr-workflow-engine.js'
import type { ReviewBundle } from '../../models/review-bundle.js'

/** 一次贡献生成的输入。 */
export interface ContribRequest {
  /** 关联任务 ID（手动生成可缺省） */
  taskId?: string
  /** 关联任务运行 ID */
  taskRunId?: string
  /** 仓库信息（owner/name/githubId） */
  repository: { owner: string; name: string; githubId: number }
  /** 目标 Issue（搜索候选场景必有；手动贡献可缺省） */
  issue?: { number: number; githubId: number; title: string; url: string }
  /** 规范化贡献意图 */
  intent: string
  /** 工作目录（已 clone 的仓库路径） */
  workingDirectory: string
  /** 远端事实（去重用）：关联 PR / 已有分支 / 已发布 PR */
  remoteFacts?: RemoteFacts
  /** 意图指纹（手动贡献/去重增强用） */
  intentFingerprint?: string
  /** 改动指纹（意图去重用） */
  changeFingerprint?: string
}

/** 去重判定结果。 */
export type DedupVerdict =
  | { duplicate: false }
  | { duplicate: true; reason: string; existingWorkItemId?: string }

/**
 * 编排结果：
 *  - kind='duplicate'：未进入生成（去重拦截）
 *  - kind='generated'：已生成到 review 状态，附带 ReviewBundle 与工作项
 *  - kind='agent-failed'：Agent 失败，工作项置 failed
 */
export type ContribResult =
  | { kind: 'duplicate'; reason: string }
  | { kind: 'generated'; workItem: PRWorkItemRecord; bundle: ReviewBundle; version: number }
  | { kind: 'agent-failed'; workItem: PRWorkItemRecord; reason: string }

/** Orchestrator 依赖（全部 Port/引擎 + 存储）。 */
export interface ContribOrchestratorDeps {
  storage: StoragePort
  dedup: DedupEngine
  agent: AgentPort
  clock?: ClockPort
  /** 生成一个唯一工作项 ID（缺省用时间戳+随机） */
  idGenerator?: () => string
}

/** 给 Agent 的指令构建：从 Issue + 意图拼装。 */
function buildInstruction(req: ContribRequest): string {
  const parts: string[] = []
  parts.push(`贡献意图：${req.intent}`)
  if (req.issue) {
    parts.push(`目标 Issue #${req.issue.number}（${req.issue.title}）： ${req.issue.url}`)
  }
  parts.push('请在仓库工作目录中完成上述意图对应的代码改动，保持改动最小且聚焦。')
  parts.push('完成后执行合理验证（如类型检查/测试），并产出变更 diff。')
  return parts.join('\n')
}

export class ContribOrchestrator {
  private readonly table: TablePort<string, unknown>
  private readonly clock: ClockPort

  constructor(private readonly deps: ContribOrchestratorDeps) {
    this.table = deps.storage.prWorkItems
    this.clock = deps.clock ?? systemClock
  }

  /** 去重判定（规则 1/2/3/5/6/8 由 DedupEngine 内部实现）。 */
  async checkDuplication(req: ContribRequest): Promise<DedupVerdict> {
    if (!req.issue) {
      // 手动贡献没有 Issue 主键，仅按意图指纹去重（若有）
      if (req.intentFingerprint) {
        const rec = this.deps.dedup.findActiveByIssueKey(req.intentFingerprint)
        if (rec) return { duplicate: true, reason: '意图指纹命中活跃工作项', existingWorkItemId: rec.workItemId }
      }
      return { duplicate: false }
    }
    const key = issueDeduplicationKey(req.repository.githubId, req.issue.githubId)
    const decision = await this.deps.dedup.checkAll(
      {
        key,
        taskId: req.taskId ?? 'manual',
        intentFingerprint: req.intentFingerprint,
      },
      req.remoteFacts
        ? { issue: req.issue as unknown as import('../../ports/github.js').IssueInfo, facts: req.remoteFacts, repoMeta: req.repository as unknown as import('../../ports/github.js').RepositoryInfo }
        : undefined,
    )
    if (decision.duplicate) {
      return { duplicate: true, reason: decision.reason, existingWorkItemId: decision.existingWorkItemId }
    }
    return { duplicate: false }
  }

  /** 创建处于 candidate 状态的工作项并持久化。 */
  private createWorkItem(req: ContribRequest, id: string, now: string): PRWorkItemRecord {
    const record: PRWorkItemRecord = PRWorkItemRecord.parse({
      id,
      taskId: req.taskId,
      taskRunId: req.taskRunId,
      repository: { owner: req.repository.owner, name: req.repository.name, githubId: req.repository.githubId },
      issue: req.issue
        ? { number: req.issue.number, githubId: req.issue.githubId, title: req.issue.title, url: req.issue.url }
        : undefined,
      status: 'candidate' as PRWorkItemStatus,
      currentVersion: 1,
      contributionIntent: req.intent,
      changeFingerprint: req.changeFingerprint,
      createdAt: now,
      updatedAt: now,
    })
    this.table.put(id, record as unknown)
    return record
  }

  /** 原子更新某工作项的状态（经 PRWorkflowEngine 校验）。 */
  private applyTransition(id: string, from: PRWorkItemStatus, action: Parameters<typeof transition>[0]['action'], version?: number): TransitionResult {
    const res = transition({ from, action, version })
    if (!res.ok) return res
    const now = this.clock.now().toISOString()
    const updated: PRWorkItemRecord = PRWorkItemRecord.parse({
      ...(this.table.get(id) as PRWorkItemRecord),
      status: res.to,
      updatedAt: now,
      ...(res.approvedVersion !== undefined ? { approvedVersion: res.approvedVersion } : {}),
    })
    this.table.put(id, updated as unknown)
    return res
  }

  /**
   * 执行一次完整贡献生成（到 review 状态为止）。
   * 调用方负责在拿到 review 包后请求审批；批准再触发 M4 发布。
   */
  async generate(req: ContribRequest): Promise<ContribResult> {
    const dup = await this.checkDuplication(req)
    if (dup.duplicate) {
      return { kind: 'duplicate', reason: dup.reason }
    }

    const now = this.clock.now().toISOString()
    const id = this.deps.idGenerator ? this.deps.idGenerator() : `wi_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

    // 1) candidate
    const created = this.createWorkItem(req, id, now)

    // 2) candidate -> generating
    const toGen = this.applyTransition(id, 'candidate', 'generate')
    if (!toGen.ok) return { kind: 'agent-failed', workItem: created, reason: toGen.reason }

    // 3) 委托 Agent 完成代码工作
    const agentReq: CodeWorkRequest = {
      instruction: buildInstruction(req),
      workingDirectory: req.workingDirectory,
    }
    const agentResult = await this.deps.agent.delegateCodeWork(agentReq)

    if (!agentResult.success) {
      const toFail = this.applyTransition(id, 'generating', 'fail')
      const failed = this.table.get(id) as PRWorkItemRecord
      return {
        kind: 'agent-failed',
        workItem: toFail.ok ? (failed) : created,
        reason: agentResult.failureReason ?? 'Agent 未完成代码工作',
      }
    }

    // 4) generating -> review（提交审阅）
    const toReview = this.applyTransition(id, 'generating', 'submit-for-review')
    if (!toReview.ok) return { kind: 'agent-failed', workItem: created, reason: toReview.reason }

    const current = this.table.get(id) as PRWorkItemRecord
    const ctx: BuildContext = {
      repository: req.repository,
      issue: req.issue,
      branchName: current.branchName ?? 'openscout/contrib',
      intent: req.intent,
      diff: agentResult.diff ?? '',
      changedFiles: agentResult.changedFiles ?? [],
      validations: agentResult.validationResults ?? [],
      summary: agentResult.summary ?? '',
      generatedAt: now,
      version: current.currentVersion,
    }
    const bundle = buildReviewBundle(ctx, agentResult)

    return { kind: 'generated', workItem: current, bundle, version: current.currentVersion }
  }

  /** 从终态/失败态重置为 candidate（重新生成）。 */
  async reset(id: string): Promise<TransitionResult> {
    const rec = this.table.get(id) as PRWorkItemRecord | undefined
    if (!rec) return { ok: false, reason: '工作项不存在' }
    if (!canReset(rec.status)) {
      return { ok: false, reason: `状态 ${rec.status} 不可 reset` }
    }
    return this.applyTransition(id, rec.status, 'reset')
  }
}
