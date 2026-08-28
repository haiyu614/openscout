/**
 * PublishEngine — 发布执行引擎（纯逻辑，fail-closed）。
 *
 * 把「已批准（approved）的 ReviewBundle」安全地发布到 GitHub：
 *   approved → (审批版本有效?) → fork → branch → push → createPR → published
 * 任何一步失败 → failed（状态回写），绝不静默半发布。
 *
 * 架构边界（关键）：
 *  - Core 不持有文件系统，无法读取 Agent 工作区的文件字节；
 *  - 文件内容（Commit[]）由宿主 Adapter 从工作区读出后，作为 `commits` 传入本引擎；
 *  - 本引擎只负责：审批版本校验、GitHub 写序列编排、状态机推进、失败回写。
 *  - 不接触 DSH/Cordis。
 */

import {
  PRWorkItemRecord,
  PRWorkItemStatus,
} from '../../models/pr-work-item.js'
import type { GitHubPort, ForkResult, Commit } from '../../ports/github.js'
import type { StoragePort, TablePort } from '../../ports/storage.js'
import type { ClockPort } from '../../ports/clock.js'
import type { ApprovalPort } from '../../ports/approval.js'
import { systemClock } from '../../ports/clock.js'
import { transition } from './pr-workflow-engine.js'
import { isApprovalValid } from './approval-gate.js'
import type { ReviewBundle } from '../../models/review-bundle.js'

/** 发布入参。 */
export interface PublishRequest {
  /** 工作项 ID（必须处于 approved 且 reviewBundle 存在） */
  workItemId: string
  /** 待推送的文件内容（由 Adapter 从工作区读出；Core 不读 fs） */
  commits?: Commit[]
  /** 发布为草稿 PR（默认 true，遵循 plan 安全策略） */
  asDraft?: boolean
}

/** 发布结果。 */
export type PublishResult =
  | { ok: true; workItem: PRWorkItemRecord; remotePR: { number: number; url: string }; draft: boolean }
  | { ok: false; workItem: PRWorkItemRecord; reason: string }

/** PublishEngine 依赖。 */
export interface PublishEngineDeps {
  storage: StoragePort
  github: GitHubPort
  approval: ApprovalPort
  clock?: ClockPort
}

export class PublishEngine {
  private readonly table: TablePort<string, unknown>
  private readonly clock: ClockPort

  constructor(private readonly deps: PublishEngineDeps) {
    this.table = deps.storage.prWorkItems
    this.clock = deps.clock ?? systemClock
  }

  /** 原子状态流转并回写存储。 */
  private apply(id: string, from: PRWorkItemStatus, action: 'publish' | 'publish-succeeded' | 'publish-failed'): PRWorkItemRecord | { error: string } {
    const cur = this.table.get(id) as PRWorkItemRecord | undefined
    if (!cur) return { error: '工作项不存在' }
    const res = transition({ from, action })
    if (!res.ok) return { error: res.reason }
    const now = this.clock.now().toISOString()
    const updated: PRWorkItemRecord = PRWorkItemRecord.parse({ ...cur, status: res.to, updatedAt: now })
    this.table.put(id, updated as unknown)
    return updated
  }

  /**
   * 执行发布。前置：工作项处于 approved，且 approval 版本仍有效。
   * 不在此重复调 ApprovalPort（批准已在进入 approved 前完成）；但会二次确认
   * approvedVersion 与 bundle.version 一致（防并发漂移，fail-closed）。
   */
  async publish(req: PublishRequest): Promise<PublishResult> {
    const cur = this.table.get(req.workItemId) as PRWorkItemRecord | undefined
    if (!cur) {
      return { ok: false, workItem: cur as never, reason: '工作项不存在' }
    }
    if (cur.status !== 'approved') {
      return { ok: false, workItem: cur, reason: `工作项未处于 approved 状态（实际 ${cur.status}）` }
    }
    if (!cur.reviewBundle) {
      return { ok: false, workItem: cur, reason: '缺少 ReviewBundle，无法发布' }
    }
    const bundle = cur.reviewBundle as ReviewBundle
    if (!isApprovalValid(cur.approvedVersion, bundle.version)) {
      return { ok: false, workItem: cur, reason: '审批已失效（版本漂移），需重新审批' }
    }

    // 1) approved -> publishing
    const toPublishing = this.apply(req.workItemId, 'approved', 'publish')
    if ('error' in toPublishing) {
      return { ok: false, workItem: cur, reason: toPublishing.error }
    }

    const owner = cur.repository.owner
    const name = cur.repository.name

    try {
      // 2) fork（幂等：已 fork 也可复用）
      const fork: ForkResult = await this.deps.github.forkRepository(owner, name)
      const forkOwner = fork.owner

      // 3) 取默认分支 SHA 作为基线
      const baseSha = await this.deps.github.getDefaultBranchSha(owner, name)
      const branch = cur.branchName ?? `openscout/contrib-${cur.id}`

      // 4) 创建贡献分支
      await this.deps.github.createBranch(forkOwner, name, branch, baseSha)

      // 5) 推送变更（content 由 Adapter 从工作区读出并传入；Core 不读 fs）
      if (req.commits && req.commits.length > 0) {
        await this.deps.github.pushCommits(forkOwner, name, branch, req.commits)
      }

      // 6) 创建 PR（默认草稿，安全策略）
      const pr = await this.deps.github.createPullRequest({
        owner: forkOwner,
        repo: name,
        title: bundle.prTitle,
        body: bundle.prBody,
        head: `${forkOwner}:${branch}`,
        base: 'main',
        draft: req.asDraft ?? true,
      })

      // 7) publishing -> published
      const finalRec = this.apply(req.workItemId, 'publishing', 'publish-succeeded')
      if ('error' in finalRec) {
        return { ok: false, workItem: cur, reason: finalRec.error }
      }
      const done: PRWorkItemRecord = PRWorkItemRecord.parse({
        ...(finalRec as PRWorkItemRecord),
        remotePR: { number: pr.number, url: pr.htmlUrl, isDraft: req.asDraft ?? true },
        updatedAt: this.clock.now().toISOString(),
      })
      this.table.put(req.workItemId, done as unknown)
      return { ok: true, workItem: done, remotePR: { number: pr.number, url: pr.htmlUrl }, draft: req.asDraft ?? true }
    } catch (err) {
      // 失败：publishing -> failed（fail-closed：半发布也要留痕）
      this.apply(req.workItemId, 'publishing', 'publish-failed')
      const failed = this.table.get(req.workItemId) as PRWorkItemRecord
      return { ok: false, workItem: failed, reason: err instanceof Error ? err.message : String(err) }
    }
  }
}
