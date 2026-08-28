/**
 * PublishEngine 单测（纯逻辑，fail-closed 验证）。
 * 用 Mock GitHubPort / ApprovalPort + InMemoryStorage，验证状态机与 GitHub 写序列。
 */
import { describe, it, expect, vi } from 'vitest'
import { PublishEngine } from '../src/engines/contrib/publish-engine.js'
import { InMemoryStorage } from '@openscout/storage-memory'
import { fixedClock } from './mocks.js'
import { PRWorkItemRecord } from '../src/models/pr-work-item.js'
import type { GitHubPort, ForkResult, Commit } from '../src/ports/github.js'
import type { ApprovalPort, ApprovalOutcome } from '../src/ports/approval.js'

function makeGithub(overrides: Partial<Record<string, (...a: unknown[]) => unknown>> = {}) {
  const calls: Record<string, number> = {}
  const count = (k: string) => { calls[k] = (calls[k] ?? 0) + 1 }
  const gh: GitHubPort = {
    async searchRepositories() { return { totalCount: 0, items: [] } },
    async searchIssues() { return { totalCount: 0, items: [] } },
    async getRepository() { return null as never },
    async getContributingGuide() { return null },
    async getLicense() { return null },
    async getIssue() { return null as never },
    async getIssueTimeline() { return [] },
    async forkRepository(...a) { count('forkRepository'); return (overrides.forkRepository?.() ?? { owner: 'haiyu614', name: 'repo', fullName: 'haiyu614/repo', htmlUrl: '', defaultBranch: 'main' }) as ForkResult },
    async createBranch(...a) { count('createBranch'); overrides.createBranch?.() },
    async pushCommits(...a) { count('pushCommits'); overrides.pushCommits?.() },
    async createPullRequest(...a) { count('createPullRequest'); return (overrides.createPullRequest?.() ?? { number: 7, htmlUrl: 'https://github.com/octocat/repo/pull/7', state: 'open' }) },
    async closePullRequest() {},
    async deleteBranch() {},
    async getUserForks() { return [] },
    async checkBranchExists() { return false },
    async getDefaultBranchSha() { return 'sha123' },
    ...(overrides as Partial<GitHubPort>),
  }
  return { gh, calls }
}

const approval = (behave: ApprovalOutcome): ApprovalPort => ({ async requestApproval() { return behave } })

function seedWorkItem(storage: InMemoryStorage, status: string, opts: { approvedVersion?: number; withBundle?: boolean } = {}) {
  const rec = PRWorkItemRecord.parse({
    id: 'wi_1',
    repository: { owner: 'octocat', name: 'repo', githubId: 42 },
    issue: { number: 5, githubId: 99, title: 'Add tests', url: 'https://github.com/octocat/repo/issues/5' },
    status,
    currentVersion: 1,
    contributionIntent: '补测试',
    approvedVersion: opts.approvedVersion,
    reviewBundle: opts.withBundle ? {
      version: 1, diff: '', summary: 's', risks: [], commitMessage: 'm', prTitle: 't', prBody: 'b',
      validations: [], skippedValidations: [], changedFiles: ['a.ts'], generatedAt: '2026-01-01T00:00:00Z',
    } : undefined,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  })
  storage.prWorkItems.put('wi_1', rec as unknown)
  return rec
}

const clock = fixedClock('2026-01-01T00:00:00Z')

describe('PublishEngine.publish', () => {
  it('未处于 approved → 拒绝且不调用任何 GitHub 写操作', async () => {
    const storage = new InMemoryStorage()
    seedWorkItem(storage, 'review', { withBundle: true })
    const { gh, calls } = makeGithub()
    const engine = new PublishEngine({ storage, github: gh, approval: approval('unavailable') })
    const res = await engine.publish({ workItemId: 'wi_1' })
    expect(res.ok).toBe(false)
    expect(res.reason).toContain('approved')
    expect(calls.forkRepository).toBeUndefined()
  })

  it('缺 ReviewBundle → 拒绝', async () => {
    const storage = new InMemoryStorage()
    seedWorkItem(storage, 'approved', { approvedVersion: 1 })
    const { gh } = makeGithub()
    const engine = new PublishEngine({ storage, github: gh, approval: approval('unavailable') })
    const res = await engine.publish({ workItemId: 'wi_1' })
    expect(res.ok).toBe(false)
    expect(res.reason).toContain('ReviewBundle')
  })

  it('审批版本漂移 → 拒绝（fail-closed）', async () => {
    const storage = new InMemoryStorage()
    // bundle.version=1，但 approvedVersion=2 → 不一致
    seedWorkItem(storage, 'approved', { approvedVersion: 2, withBundle: true })
    // 手动把 bundle version 设为 1 以制造漂移
    const rec = storage.prWorkItems.get('wi_1') as Record<string, unknown>
    rec.reviewBundle = { ...(rec.reviewBundle as object), version: 1 }
    storage.prWorkItems.put('wi_1', rec as unknown)
    const { gh } = makeGithub()
    const engine = new PublishEngine({ storage, github: gh, approval: approval('unavailable') })
    const res = await engine.publish({ workItemId: 'wi_1' })
    expect(res.ok).toBe(false)
    expect(res.reason).toContain('审批已失效')
  })

  it('完整发布成功：fork→branch→push→PR 全部调用，状态 published', async () => {
    const storage = new InMemoryStorage()
    seedWorkItem(storage, 'approved', { approvedVersion: 1, withBundle: true })
    const { gh, calls } = makeGithub()
    const spy = vi.spyOn(gh, 'createPullRequest')
    const engine = new PublishEngine({ storage, github: gh, approval: approval('unavailable'), clock })
    const commits: Commit[] = [{ message: 'm', files: [{ path: 'a.ts', content: 'x' }] }]
    const res = await engine.publish({ workItemId: 'wi_1', commits, asDraft: true })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(calls.forkRepository).toBe(1)
    expect(calls.createBranch).toBe(1)
    expect(calls.pushCommits).toBe(1)
    expect(calls.createPullRequest).toBe(1)
    expect(res.workItem.status).toBe('published')
    expect(res.remotePR.number).toBe(7)
    const prArg = spy.mock.calls[0]![0]
    expect(prArg.draft).toBe(true)
    // head 应为 forkOwner:branch（遵循 GitHub PR 头分支语义）
    expect(prArg.head).toContain('openscout/contrib-wi_1')
  })

  it('GitHub fork 抛错 → 状态回写为 failed（fail-closed 半发布留痕）', async () => {
    const storage = new InMemoryStorage()
    seedWorkItem(storage, 'approved', { approvedVersion: 1, withBundle: true })
    const { gh } = makeGithub({ forkRepository: () => { throw new Error('rate limited') } })
    const engine = new PublishEngine({ storage, github: gh, approval: approval('unavailable'), clock })
    const res = await engine.publish({ workItemId: 'wi_1' })
    expect(res.ok).toBe(false)
    expect(res.reason).toContain('rate limited')
    const rec = storage.prWorkItems.get('wi_1') as { status: string }
    expect(rec.status).toBe('failed')
  })

  it('createPullRequest 抛错 → 状态回写 failed，不静默', async () => {
    const storage = new InMemoryStorage()
    seedWorkItem(storage, 'approved', { approvedVersion: 1, withBundle: true })
    const { gh } = makeGithub({ createPullRequest: () => { throw new Error('pr create failed') } })
    const engine = new PublishEngine({ storage, github: gh, approval: approval('unavailable'), clock })
    const res = await engine.publish({ workItemId: 'wi_1', commits: [{ message: 'm', files: [{ path: 'a.ts', content: 'x' }] }] })
    expect(res.ok).toBe(false)
    const rec = storage.prWorkItems.get('wi_1') as { status: string }
    expect(rec.status).toBe('failed')
  })
})
