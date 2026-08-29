/**
 * DedupEngine — 去重引擎（对应定位文档 §6.2 的 8 条去重规则）
 *
 * 本地注册表负责：规则 1（Issue 主键）、2（跨任务）、3（运行幂等）、
 * 5（意图去重）、6（墓碑去重）。规则 4（远端 PR/已有分支）、8（等价修复）
 * 需要 GitHub 远端事实，由调用方通过 GitHubPort 传入，引擎负责汇总判定。
 *
 * 规则 7（版本去重，多轮同工作项）在 PRWorkflowEngine 中处理，本引擎提供
 * workItemId 关联查询供其使用。
 *
 * 不依赖任何宿主框架，只依赖 StoragePort、GitHubPort、ClockPort。
 */

import type { StoragePort, TablePort } from '../ports/storage.js'
import type { IssueInfo, RepositoryInfo } from '../ports/github.js'
import type { ClockPort } from '../ports/clock.js'
import { systemClock } from '../ports/clock.js'
import {
  type DedupRecord,
  issueDeduplicationKey,
} from '../models/dedup.js'

export type DedupDecision =
  | { duplicate: false }
  | { duplicate: true; reason: string; existingWorkItemId?: string }

export interface RemoteFacts {
  /** 该 Issue 的关联 PR（来自 Issue 时间线） */
  relatedPRs?: Array<{ number: number; state: string }>
  /** 用户在该仓库已有的 fork 分支（来自 GitHubPort.getUserForks + branch 探测） */
  existingUserBranches?: string[]
  /** 系统已发布到该 Issue 的 PR（来自存储，可选传入） */
  publishedPRNumbers?: number[]
}

export interface RegisterInput {
  /** 去重键；Issue 场景用 issueDeduplicationKey */
  key: string
  workItemId: string
  taskId: string
  runId?: string
  /** 主动贡献的意图指纹（可选） */
  intentFingerprint?: string
  now?: string
}

export interface DedupEngineDeps {
  storage: StoragePort
  clock?: ClockPort
}

export class DedupEngine {
  private readonly table: TablePort<string, unknown>
  private readonly clock: ClockPort

  constructor(deps: DedupEngineDeps) {
    this.table = deps.storage.dedup
    this.clock = deps.clock ?? systemClock
  }

  // === 规则 1 + 2 + 6：注册表判定（本地事实） ===

  /**
   * 在注册表层面判断是否重复。覆盖：
   *  - 规则 1：Issue 主键已存在活跃记录 → 重复
   *  - 规则 2：跨任务命中同一 Issue，只允许一个活跃工作项 → 重复（标记来源任务）
   *  - 规则 6：墓碑记录 → 默认重复，除非显式恢复
   *  - 规则 5：意图指纹命中活跃记录 → 重复
   */
  checkLocal(opts: {
    key: string
    taskId: string
    intentFingerprint?: string
  }): DedupDecision {
    // 墓碑优先：任何键/意图命中墓碑都默认不再次生成
    const tombstone = this.findRecord(r => this.isTombstone(r) && (r.key === opts.key || Boolean(opts.intentFingerprint && r.intentFingerprint === opts.intentFingerprint)))
    if (tombstone) {
      return { duplicate: true, reason: `墓碑去重（${tombstone.tombstoneReason ?? '已关闭/拒绝'}）` }
    }

    // 规则 1 + 2：主键活跃记录
    const active = this.findRecord(r => r.status === 'active' && r.key === opts.key)
    if (active) {
      if (active.taskId !== opts.taskId) {
        return {
          duplicate: true,
          reason: '跨任务去重：同一 Issue 已有活跃工作项',
          existingWorkItemId: active.workItemId,
        }
      }
      // 同任务命中：视为幂等（规则 3 由 runId 控制），不重复创建工作项
      return {
        duplicate: true,
        reason: '同任务已存在活跃工作项（幂等）',
        existingWorkItemId: active.workItemId,
      }
    }

    // 规则 5：意图去重
    if (opts.intentFingerprint) {
      const intentHit = this.findRecord(
        r => r.status === 'active' && r.intentFingerprint === opts.intentFingerprint,
      )
      if (intentHit) {
        return {
          duplicate: true,
          reason: '意图去重：存在等价主动贡献记录',
          existingWorkItemId: intentHit.workItemId,
        }
      }
    }

    return { duplicate: false }
  }

  // === 规则 4 + 8：远端事实判定（需要 GitHubPort） ===

  /**
   * 在生成前/发布前检查远端事实：
   *  - 规则 4：Issue 已有关联 PR、用户已有 fork 分支、系统已发布 PR
   *  - 规则 8：维护者/他人已提交等价修复 → 中止
   *
   * 调用方负责先拉取 facts（owner/name/issueNumber），再传入。
   */
  checkRemote(
    issue: IssueInfo,
    facts: RemoteFacts,
    repoMeta?: RepositoryInfo,
  ): DedupDecision {
    const related = facts.relatedPRs ?? []
    const openRelated = related.filter(p => p.state === 'open' || p.state === 'merged')
    if (openRelated.length > 0) {
      return { duplicate: true, reason: '远端去重：Issue 已有关联 PR' }
    }
    if (facts.publishedPRNumbers && facts.publishedPRNumbers.length > 0) {
      return { duplicate: true, reason: '远端去重：系统已发布过该 Issue 的 PR' }
    }
    if (facts.existingUserBranches && facts.existingUserBranches.length > 0) {
      return { duplicate: true, reason: '远端去重：用户已有该仓库的 fork 分支' }
    }
    // 规则 8 由调用方在发布前结合 Issue 时间线判断等价修复；本层提供结构化入口
    void repoMeta
    return { duplicate: false }
  }

  /** 汇总：本地 + 远端 */
  async checkAll(
    opts: { key: string; taskId: string; intentFingerprint?: string },
    remote?: { issue: IssueInfo; facts: RemoteFacts; repoMeta?: RepositoryInfo },
  ): Promise<DedupDecision> {
    const local = this.checkLocal(opts)
    if (local.duplicate) return local
    if (remote) return this.checkRemote(remote.issue, remote.facts, remote.repoMeta)
    return { duplicate: false }
  }

  // === 注册（规则 1/2/5 写入） ===

  /**
   * 注册一条去重记录（生成 PR 工作项时调用）。
   * 规则 3：若传入 runId 且已存在同 runId 记录，则视为幂等更新而非新建。
   */
  async register(input: RegisterInput): Promise<DedupRecord> {
    const now = input.now ?? this.clock.now().toISOString()

    // 运行幂等：同 runId + 同 key 复用
    if (input.runId) {
      const existing = this.findRecord(r => r.runId === input.runId && r.key === input.key)
      if (existing) {
        const updated: DedupRecord = { ...existing, status: 'active', updatedAt: now }
        await this.table.put(existing.key, updated as unknown as DedupRecord)
        return updated
      }
    }

    const record: DedupRecord = {
      key: input.key,
      workItemId: input.workItemId,
      taskId: input.taskId,
      runId: input.runId,
      intentFingerprint: input.intentFingerprint,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    }
    await this.table.put(input.key, record as unknown as DedupRecord)
    return record
  }

  // === 规则 6：墓碑写入与恢复 ===

  /** 写入墓碑（用户删除/拒绝/关闭）。保留最小审计记录。 */
  async tombstone(
    key: string,
    reason: string,
    now: string = this.clock.now().toISOString(),
  ): Promise<boolean> {
    const existing = this.table.get(key) as DedupRecord | undefined
    if (!existing) return false
    const updated: DedupRecord = {
      ...existing,
      status: 'tombstone',
      tombstoneReason: reason,
      tombstoneAt: now,
      updatedAt: now,
    }
    await this.table.put(key, updated as unknown as DedupRecord)
    return true
  }

  /**
   * 显式恢复（用户明确要求重新评估）。删除墓碑记录，使下一次扫描可重新生成。
   */
  async restore(key: string): Promise<boolean> {
    return this.table.delete(key)
  }

  // === M6：跨轮/跨任务已发布 PR 记录（规则 4 增强） ===

  /**
   * 记录某去重键已发布到远端 PR（发布成功后调用）。
   * 使后续同 Issue 的扫描（含其他任务）能通过 checkRemote 的 publishedPRNumbers 识别，
   * 避免重复发布同一个 Issue。
   */
  async recordPublication(key: string, prNumber: number, now: string = this.clock.now().toISOString()): Promise<void> {
    const existing = this.table.get(key) as DedupRecord | undefined
    const updated: DedupRecord = existing
      ? { ...existing, publishedPRNumber: prNumber, updatedAt: now }
      : {
          key,
          workItemId: `pr-${prNumber}`,
          status: 'active',
          taskId: 'published',
          updatedAt: now,
          createdAt: now,
          publishedPRNumber: prNumber,
        }
    await this.table.put(key, updated as unknown as DedupRecord)
  }

  /** 返回某 Issue 主键已发布的 PR 编号列表（跨任务/跨轮可见）。 */
  publishedPRNumbersFor(key: string): number[] {
    const out: number[] = []
    for (const [, v] of this.table.entries()) {
      const r = v as DedupRecord
      if (r.key === key && r.publishedPRNumber !== undefined) out.push(r.publishedPRNumber)
    }
    return out
  }

  /** 查询某 Issue 主键是否已存在活跃工作项（供 PRWorkflowEngine 版本去重使用） */
  findActiveByIssueKey(key: string): DedupRecord | undefined {
    return this.findRecord(r => r.status === 'active' && r.key === key)
  }

  // === 内部工具 ===

  private findRecord(pred: (r: DedupRecord) => boolean): DedupRecord | undefined {
    for (const [, v] of this.table.entries()) {
      const rec = v as DedupRecord
      if (pred(rec)) return rec
    }
    return undefined
  }

  private isTombstone(r: DedupRecord): boolean {
    return r.status === 'tombstone'
  }
}

export { issueDeduplicationKey }
