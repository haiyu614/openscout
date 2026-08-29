/**
 * ScanOrchestrator — 单次任务运行编排（纯逻辑）
 *
 * 一次 scan 执行：
 *   1. 对每个目标仓库调用 SearchEngine.searchIssues（按任务 filters / 水位）
 *   2. 对每个候选跑 DedupEngine（含远端事实可选）
 *   3. 对通过去重且可行性达标的候选，调用 ContribOrchestrator.generate 生成贡献包
 *   4. 受 maxIssuesPerRun / maxPRsPerRun / maxConcurrent 约束（fail-closed）
 *
 * 不持有 Agent/GitHub 具体实现；依赖宿主注入的 SearchEngine / DedupEngine /
 * ContribOrchestrator / GitHubPort / TaskEngine / ClockPort。
 */

import type { StoragePort, TablePort } from '../ports/storage.js'
import type { ClockPort, GitHubPort } from '../ports/index.js'
import { systemClock } from '../ports/clock.js'
import { nextOccurrence } from './cron.js'
import { TaskRecord } from '../models/task.js'
import { TaskRunRecord } from '../models/task-run.js'

export interface ScanDeps {
  storage: StoragePort
  github: GitHubPort
  searchEngine: { searchIssues(params: unknown): Promise<{ candidates: Array<{ issue: { number: number; githubId: number; title: string; htmlUrl: string }; feasibility: string }> }> }
  dedupEngine: { check(params: { key: string; taskId: string; intentFingerprint?: string }): { duplicate: boolean; reason?: string } }
  orchestrator: { generate(req: unknown): Promise<{ kind: 'duplicate' | 'agent-failed' | 'generated'; workItem?: { id: string } }> }
  taskEngine: {
    getTask(id: string): TaskRecord | undefined
    checkQuota(id: string, now: Date): { allowed: boolean; reason?: string }
    recordPRs(id: string, count: number, now: Date): Promise<void>
    setWatermark(id: string, iso: string): Promise<void>
  }
  clock?: ClockPort
  /** 生成贡献包前的可选远端事实收集（用于更精确去重），默认返回空 */
  fetchRemoteFacts?: (repo: { owner: string; name: string }, issueNumber: number) => Promise<unknown>
}

export interface ScanResult {
  runId: string
  taskId: string
  status: 'completed' | 'failed' | 'cancelled'
  issuesScanned: number
  issuesMatched: number
  prsGenerated: number
  watermarkAfter?: string
  errorMessage?: string
}

export class ScanOrchestrator {
  private readonly storage: StoragePort
  private readonly runTable: TablePort<string, unknown>
  private readonly deps: ScanDeps
  private readonly clock: ClockPort

  constructor(deps: ScanDeps) {
    this.storage = deps.storage
    this.runTable = deps.storage.taskRuns
    this.deps = deps
    this.clock = deps.clock ?? systemClock
  }

  async run(taskId: string): Promise<ScanResult> {
    const now = this.clock.now()
    const task = this.deps.taskEngine.getTask(taskId)
    if (!task) return this.fail(taskId, '任务不存在')
    const runId = `run_${now.getTime().toString(36)}_${Math.random().toString(36).slice(2, 6)}`

    // 配额预检（日/周）
    const qc = this.deps.taskEngine.checkQuota(taskId, now)
    if (!qc.allowed) {
      return this.complete(runId, taskId, { issuesScanned: 0, issuesMatched: 0, prsGenerated: 0, note: qc.reason })
    }

    const runRec: TaskRunRecord = {
      id: runId,
      taskId,
      status: 'running',
      scheduledAt: now.toISOString(),
      startedAt: now.toISOString(),
      issuesScanned: 0,
      issuesMatched: 0,
      prsGenerated: 0,
      quotaUsed: 0,
    }
    await this.runTable.put(runId, runRec)

    let scanned = 0
    let matched = 0
    let generated = 0
    let watermarkAfter: string | undefined

    try {
      for (const repo of task.repositories) {
        const searchRes = await this.deps.searchEngine.searchIssues({
          repository: { owner: repo.owner, name: repo.name },
          labels: task.filters.labels,
          keywords: task.filters.keywords,
          languages: task.filters.languages,
          excludeLabels: task.filters.excludeLabels,
          maxAgeDays: task.filters.maxAgeDays,
          difficulty: task.filters.difficulty,
          limit: task.quotas.maxIssuesPerRun,
          since: task.scanWatermark,
        })
        const candidates = searchRes.candidates
        scanned += candidates.length

        // 按可行性排序，优先 high
        const ordered = [...candidates].sort((a, b) => feasibilityRank(b.feasibility) - feasibilityRank(a.feasibility))
        for (const c of ordered) {
          if (generated >= task.quotas.maxPRsPerRun) break
          if (matched >= task.quotas.maxIssuesPerRun) break
          const key = `issue:${repo.githubId}:${c.issue.number}`
          const dedup = this.deps.dedupEngine.check({ key, taskId })
          if (dedup.duplicate) continue
          matched++
          // 远端事实（可选）
          let remoteFacts: unknown
          if (this.deps.fetchRemoteFacts) {
            try { remoteFacts = await this.deps.fetchRemoteFacts({ owner: repo.owner, name: repo.name }, c.issue.number) } catch { remoteFacts = undefined }
          }
          const gen = await this.deps.orchestrator.generate({
            repository: { owner: repo.owner, name: repo.name, githubId: repo.githubId },
            issue: { number: c.issue.number, githubId: c.issue.githubId, title: c.issue.title, url: c.issue.htmlUrl },
            intent: `任务 ${taskId} 自动贡献`,
            workingDirectory: undefined,
            remoteFacts,
          })
          if (gen.kind === 'generated') {
            generated++
          }
        }
        // 更新水位为该仓库扫描后时间
        watermarkAfter = this.clock.now().toISOString()
      }

      // 记录 PR 配额用量
      await this.deps.taskEngine.recordPRs(taskId, generated, now)
      if (watermarkAfter) await this.deps.taskEngine.setWatermark(taskId, watermarkAfter)

      return this.complete(runId, taskId, { issuesScanned: scanned, issuesMatched: matched, prsGenerated: generated, watermarkAfter })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      await this.patchRun(runId, { status: 'failed', completedAt: this.clock.now().toISOString(), errorMessage: msg })
      void this.deps.taskEngine.setWatermark(taskId, watermarkAfter ?? now.toISOString())
      return {
        runId,
        taskId,
        status: 'failed',
        issuesScanned: scanned,
        issuesMatched: matched,
        prsGenerated: generated,
        watermarkAfter,
        errorMessage: msg,
      }
    }
  }

  private async patchRun(runId: string, patch: Partial<TaskRunRecord>): Promise<void> {
    const cur = (this.runTable.get(runId) as TaskRunRecord | undefined) ?? { id: runId, taskId: '', status: 'running', scheduledAt: '', issuesScanned: 0, issuesMatched: 0, prsGenerated: 0, quotaUsed: 0 }
    await this.runTable.put(runId, { ...cur, ...patch })
  }

  private async complete(
    runId: string,
    taskId: string,
    data: { issuesScanned: number; issuesMatched: number; prsGenerated: number; watermarkAfter?: string; note?: string },
  ): Promise<ScanResult> {
    await this.patchRun(runId, {
      status: 'completed',
      completedAt: this.clock.now().toISOString(),
      issuesScanned: data.issuesScanned,
      issuesMatched: data.issuesMatched,
      prsGenerated: data.prsGenerated,
      watermarkAfter: data.watermarkAfter,
      errorMessage: data.note,
    })
    return {
      runId,
      taskId,
      status: 'completed',
      issuesScanned: data.issuesScanned,
      issuesMatched: data.issuesMatched,
      prsGenerated: data.prsGenerated,
      watermarkAfter: data.watermarkAfter,
      errorMessage: data.note,
    }
  }

  private fail(taskId: string, msg: string): ScanResult {
    return { runId: 'none', taskId, status: 'failed', issuesScanned: 0, issuesMatched: 0, prsGenerated: 0, errorMessage: msg }
  }
}

function feasibilityRank(f: string): number {
  switch (f) {
    case 'high': return 3
    case 'medium': return 2
    case 'low': return 1
    default: return 0
  }
}
