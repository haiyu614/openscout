import { describe, it, expect, vi } from 'vitest'
import { ContribOrchestrator } from '../src/engines/contrib/orchestrator.js'
import { DedupEngine } from '../src/engines/dedup.js'
import { InMemoryStorage } from '@openscout/storage-memory'
import { fixedClock } from './mocks.js'
import { transition, canRevise, nextVersion, isTerminal } from '../src/engines/contrib/pr-workflow-engine.js'
import type { AgentPort, CodeWorkResult } from '../src/ports/agent.js'
import type { IssueInfo, RepositoryInfo } from '../src/ports/github.js'

function makeAgent(result: Partial<CodeWorkResult>): AgentPort {
  return {
    async delegateCodeWork() {
      return {
        success: true,
        changedFiles: ['src/x.ts'],
        validationResults: [{ command: 'npm test', passed: true, output: 'ok' }],
        summary: '完成改动',
        diff: '@@ -0,0 +1 @@\n+hello',
        ...result,
      }
    },
  }
}

const repo: RepositoryInfo = {
  githubId: 42, owner: 'octocat', name: 'hello', fullName: 'octocat/hello',
  description: null, language: 'TypeScript', license: 'mit', stars: 10, forks: 1,
  openIssues: 3, archived: false, defaultBranch: 'main', createdAt: '', updatedAt: '',
  pushedAt: '', topics: [], htmlUrl: '',
}
const issue: IssueInfo = {
  githubId: 99, number: 5, title: 'Add tests', body: null, state: 'open',
  labels: [], assignees: [], comments: 0, createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z', htmlUrl: 'https://github.com/octocat/hello/issues/5',
}

function setup(agent: AgentPort, idGen = () => 'wi_1') {
  const storage = new InMemoryStorage()
  const dedup = new DedupEngine({ storage, clock: fixedClock('2026-01-01T00:00:00Z') })
  const orchestrator = new ContribOrchestrator({
    storage, dedup, agent, clock: fixedClock('2026-01-01T00:00:00Z'), idGenerator: idGen,
  })
  return { storage, dedup, orchestrator }
}

describe('M6 状态机扩展', () => {
  it('canRevise 覆盖 review/approved/published/revising', () => {
    expect(canRevise('review')).toBe(true)
    expect(canRevise('approved')).toBe(true)
    expect(canRevise('published')).toBe(true)
    expect(canRevise('revising')).toBe(true)
    expect(canRevise('candidate')).toBe(false)
    expect(canRevise('failed')).toBe(false)
  })

  it('review:revise → revising（审阅前重新打开）', () => {
    const r = transition({ from: 'review', action: 'revise' })
    expect(r.ok && r.to).toBe('revising')
  })

  it('approved:revise → revising（批准后继续改）', () => {
    const r = transition({ from: 'approved', action: 'revise' })
    expect(r.ok && r.to).toBe('revising')
  })

  it('revising:submit-for-review → review（本轮修改完成重审）', () => {
    const r = transition({ from: 'revising', action: 'submit-for-review' })
    expect(r.ok && r.to).toBe('review')
  })

  it('nextVersion 递增', () => {
    expect(nextVersion(1)).toBe(2)
    expect(nextVersion(3)).toBe(4)
  })

  it('非法多轮流转被拒（fail-closed）', () => {
    expect(transition({ from: 'candidate', action: 'revise' }).ok).toBe(false)
    expect(transition({ from: 'discarded', action: 'revise' }).ok).toBe(false)
  })
})

describe('M6 多轮修改 revise', () => {
  it('review 状态 revise：版本递增并回到 review', async () => {
    const { storage, orchestrator } = setup(makeAgent({}), () => 'wi_r1')
    const gen = await orchestrator.generate({
      taskId: 't1',
      repository: { owner: repo.owner, name: repo.name, githubId: repo.githubId },
      issue: { number: issue.number, githubId: issue.githubId, title: issue.title, url: issue.htmlUrl },
      intent: '补测试', workingDirectory: '/tmp/w',
    })
    expect(gen.kind).toBe('generated')
    const v1 = (gen as any).version
    expect(v1).toBe(1)

    const rev = await orchestrator.revise('wi_r1', '再补一些测试')
    expect(rev.kind).toBe('generated')
    const rev2 = rev as any
    expect(rev2.version).toBe(v1 + 1)
    expect(rev2.workItem.currentVersion).toBe(v1 + 1)
    expect(rev2.workItem.status).toBe('review')
    expect(rev2.workItem.reviewBundle.version).toBe(v1 + 1)
  })

  it('published 状态 revise：重新打开迭代（多轮修改 PR）', async () => {
    const { storage, orchestrator } = setup(makeAgent({}), () => 'wi_r2')
    const gen = await orchestrator.generate({
      taskId: 't1',
      repository: { owner: repo.owner, name: repo.name, githubId: repo.githubId },
      issue: { number: issue.number, githubId: issue.githubId, title: issue.title, url: issue.htmlUrl },
      intent: '补测试', workingDirectory: '/tmp/w',
    })
    // 模拟已批准 + 已发布
    await orchestrator.approve('wi_r2')
    const item = storage.prWorkItems.get('wi_r2') as any
    item.status = 'published'
    storage.prWorkItems.put('wi_r2', item)

    const rev = await orchestrator.revise('wi_r2')
    expect(rev.kind).toBe('generated')
    expect((rev as any).version).toBe(2)
    expect((rev as any).workItem.status).toBe('review')
  })

  it('非多轮状态 revise 被拒（fail-closed）', async () => {
    const { orchestrator } = setup(makeAgent({}), () => 'wi_r3')
    // 仅 createWorkItem 到 candidate 的便捷：直接造一个 failed 工作项
    const storage = new InMemoryStorage()
    const dedup = new DedupEngine({ storage, clock: fixedClock('2026-01-01T00:00:00Z') })
    const orch2 = new ContribOrchestrator({ storage, dedup, agent: makeAgent({}), clock: fixedClock('2026-01-01T00:00:00Z'), idGenerator: () => 'wi_x' })
    storage.prWorkItems.put('wi_x', {
      id: 'wi_x', status: 'failed', currentVersion: 1, repository: { owner: 'o', name: 'n', githubId: 1 },
      contributionIntent: 'x', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    } as any)
    const rev = await orch2.revise('wi_x')
    expect(rev.kind).toBe('agent-failed')
    expect((rev as any).reason).toContain('不可 revise')
    void orchestrator
  })

  it('第二轮 Agent 失败时回到 failed，版本不递增', async () => {
    const { orchestrator } = setup(makeAgent({}), () => 'wi_r4')
    await orchestrator.generate({
      taskId: 't1',
      repository: { owner: repo.owner, name: repo.name, githubId: repo.githubId },
      issue: { number: issue.number, githubId: issue.githubId, title: issue.title, url: issue.htmlUrl },
      intent: '补测试', workingDirectory: '/tmp/w',
    })
    const failingAgent = makeAgent({ success: false, failureReason: '编译不过' })
    const storage = new InMemoryStorage()
    const dedup = new DedupEngine({ storage, clock: fixedClock('2026-01-01T00:00:00Z') })
    const orch2 = new ContribOrchestrator({ storage, dedup, agent: failingAgent, clock: fixedClock('2026-01-01T00:00:00Z'), idGenerator: () => 'wi_r4' })
    // 预置一个 review 状态工作项
    storage.prWorkItems.put('wi_r4', {
      id: 'wi_r4', status: 'review', currentVersion: 1, repository: { owner: 'o', name: 'n', githubId: 42 },
      contributionIntent: 'x', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    } as any)
    const rev = await orch2.revise('wi_r4')
    expect(rev.kind).toBe('agent-failed')
    const item = storage.prWorkItems.get('wi_r4') as any
    expect(item.status).toBe('failed')
    expect(item.currentVersion).toBe(1)
  })

  it('listWorkItems 返回全部', async () => {
    const { storage, orchestrator } = setup(makeAgent({}), () => 'wi_l')
    await orchestrator.generate({
      taskId: 't1',
      repository: { owner: repo.owner, name: repo.name, githubId: repo.githubId },
      issue: { number: issue.number, githubId: issue.githubId, title: issue.title, url: issue.htmlUrl },
      intent: '补测试', workingDirectory: '/tmp/w',
    })
    expect(orchestrator.listWorkItems().length).toBe(1)
  })
})

describe('M6 去重完善：跨轮/跨任务已发布 PR', () => {
  it('recordPublication 后 publishedPRNumbersFor 可见', async () => {
    const storage = new InMemoryStorage()
    const dedup = new DedupEngine({ storage, clock: fixedClock('2026-01-01T00:00:00Z') })
    await dedup.recordPublication('42:99', 7)
    expect(dedup.publishedPRNumbersFor('42:99')).toEqual([7])
  })

  it('跨任务意图去重（规则 5）仍生效', () => {
    const storage = new InMemoryStorage()
    const dedup = new DedupEngine({ storage, clock: fixedClock('2026-01-01T00:00:00Z') })
    const fp = '42|main|add tests|abc'
    storage.dedup.put('intent:1', {
      key: 'intent:1', workItemId: 'wi_a', status: 'active', taskId: 'task-a',
      intentFingerprint: fp, updatedAt: '2026-01-01T00:00:00Z', createdAt: '2026-01-01T00:00:00Z',
    } as any)
    const decision = dedup.checkLocal({ key: '42:0', taskId: 'task-b', intentFingerprint: fp })
    expect(decision.duplicate).toBe(true)
    expect(decision.reason).toContain('意图去重')
  })

  it('墓碑后同键不再生成，restore 后可恢复', async () => {
    const storage = new InMemoryStorage()
    const dedup = new DedupEngine({ storage, clock: fixedClock('2026-01-01T00:00:00Z') })
    storage.dedup.put('42:99', {
      key: '42:99', workItemId: 'wi_old', status: 'active', taskId: 't1',
      updatedAt: '2026-01-01T00:00:00Z', createdAt: '2026-01-01T00:00:00Z',
    } as any)
    expect(dedup.checkLocal({ key: '42:99', taskId: 't2' }).duplicate).toBe(true)
    await dedup.tombstone('42:99', 'user-rejected')
    expect(dedup.checkLocal({ key: '42:99', taskId: 't2' }).reason).toContain('墓碑')
    await dedup.restore('42:99')
    expect(dedup.checkLocal({ key: '42:99', taskId: 't2' }).duplicate).toBe(false)
  })

  it('跨任务主键去重（规则 2）标记来源任务', () => {
    const storage = new InMemoryStorage()
    const dedup = new DedupEngine({ storage, clock: fixedClock('2026-01-01T00:00:00Z') })
    storage.dedup.put('42:99', {
      key: '42:99', workItemId: 'wi_src', status: 'active', taskId: 'task-src',
      updatedAt: '2026-01-01T00:00:00Z', createdAt: '2026-01-01T00:00:00Z',
    } as any)
    const decision = dedup.checkLocal({ key: '42:99', taskId: 'task-other' })
    expect(decision.duplicate).toBe(true)
    expect(decision.reason).toContain('跨任务')
    expect(decision.existingWorkItemId).toBe('wi_src')
  })
})
