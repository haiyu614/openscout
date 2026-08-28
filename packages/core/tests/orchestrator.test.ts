/**
 * ContribOrchestrator 单测（工作流编排纯逻辑）。
 * 使用 Mock AgentPort + 真实 DedupEngine + InMemoryStorage，不连接 DSH/GitHub。
 */
import { describe, it, expect, vi } from 'vitest'
import { ContribOrchestrator } from '../src/engines/contrib/orchestrator.js'
import { DedupEngine } from '../src/engines/dedup.js'
import { InMemoryStorage } from '@openscout/storage-memory'
import { fixedClock } from './mocks.js'
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

function setup(agent: AgentPort, idGen?: () => string) {
  const storage = new InMemoryStorage()
  const dedup = new DedupEngine({ storage, clock: fixedClock('2026-01-01T00:00:00Z') })
  const orchestrator = new ContribOrchestrator({
    storage, dedup, agent, clock: fixedClock('2026-01-01T00:00:00Z'), idGenerator: idGen ?? (() => 'wi_1'),
  })
  return { storage, dedup, orchestrator }
}

describe('ContribOrchestrator.generate', () => {
  it('去重命中时返回 duplicate，不创建工作项', async () => {
    const { storage, orchestrator } = setup(makeAgent({}))
    // 预先注册去重记录（规则 1）
    const storage2 = storage as unknown as { dedup: { put: (k: string, v: unknown) => void } }
    storage2.dedup.put('42:99', {
      key: '42:99', workItemId: 'wi_old', status: 'active', taskId: 't1',
      updatedAt: '2026-01-01T00:00:00Z', createdAt: '2026-01-01T00:00:00Z',
    })
    const res = await orchestrator.generate({
      repository: { owner: repo.owner, name: repo.name, githubId: repo.githubId },
      issue: { number: issue.number, githubId: issue.githubId, title: issue.title, url: issue.htmlUrl },
      intent: '补测试', workingDirectory: '/tmp/w',
    })
    expect(res.kind).toBe('duplicate')
    expect((storage.prWorkItems as { size: number }).size).toBe(0)
  })

  it('完整生成：candidate -> generating -> review，并产出 ReviewBundle', async () => {
    const { storage, orchestrator } = setup(makeAgent({}), () => 'wi_gen')
    const res = await orchestrator.generate({
      taskId: 't1',
      repository: { owner: repo.owner, name: repo.name, githubId: repo.githubId },
      issue: { number: issue.number, githubId: issue.githubId, title: issue.title, url: issue.htmlUrl },
      intent: '为 hello 补单元测试', workingDirectory: '/tmp/w',
    })
    expect(res.kind).toBe('generated')
    if (res.kind !== 'generated') return
    expect(res.workItem.status).toBe('review')
    expect(res.workItem.id).toBe('wi_gen')
    expect(res.bundle.prTitle).toContain('#5')
    expect(res.version).toBe(1)
  })

  it('Agent 失败时工作项进入 failed 状态', async () => {
    const { orchestrator } = setup(makeAgent({ success: false, failureReason: '编译错误' }), () => 'wi_fail')
    const res = await orchestrator.generate({
      repository: { owner: repo.owner, name: repo.name, githubId: repo.githubId },
      issue: { number: issue.number, githubId: issue.githubId, title: issue.title, url: issue.htmlUrl },
      intent: '补测试', workingDirectory: '/tmp/w',
    })
    expect(res.kind).toBe('agent-failed')
    if (res.kind !== 'agent-failed') return
    expect(res.workItem.status).toBe('failed')
    expect(res.reason).toContain('编译错误')
  })

  it('委托 Agent 时传入工作目录与意图指令', async () => {
    const agent = makeAgent({})
    const spy = vi.spyOn(agent, 'delegateCodeWork')
    const { orchestrator } = setup(agent, () => 'wi_spy')
    await orchestrator.generate({
      repository: { owner: repo.owner, name: repo.name, githubId: repo.githubId },
      issue: { number: issue.number, githubId: issue.githubId, title: issue.title, url: issue.htmlUrl },
      intent: '实现缓存层', workingDirectory: '/workspace/hello',
    })
    expect(spy).toHaveBeenCalledTimes(1)
    const req = spy.mock.calls[0]![0]
    expect(req.workingDirectory).toBe('/workspace/hello')
    expect(req.instruction).toContain('实现缓存层')
    expect(req.instruction).toContain('#5')
  })

  it('手动贡献（无 Issue）经意图指纹去重', async () => {
    const { orchestrator } = setup(makeAgent({}), () => 'wi_manual')
    const res = await orchestrator.generate({
      repository: { owner: repo.owner, name: repo.name, githubId: repo.githubId },
      intent: '重构构建脚本', workingDirectory: '/tmp/w',
      intentFingerprint: 'fp_manual_1',
    })
    expect(res.kind).toBe('generated')
  })
})

describe('ContribOrchestrator.reset', () => {
  it('failed 状态可 reset 回 candidate', async () => {
    const { storage, orchestrator } = setup(makeAgent({ success: false }), () => 'wi_r')
    const gen = await orchestrator.generate({
      repository: { owner: repo.owner, name: repo.name, githubId: repo.githubId },
      issue: { number: issue.number, githubId: issue.githubId, title: issue.title, url: issue.htmlUrl },
      intent: '补测试', workingDirectory: '/tmp/w',
    })
    expect(gen.kind).toBe('agent-failed')
    const r = await orchestrator.reset('wi_r')
    expect(r.ok).toBe(true)
    const rec = storage.prWorkItems.get('wi_r') as { status: string }
    expect(rec.status).toBe('candidate')
  })

  it('review 状态不可 reset', async () => {
    const { orchestrator } = setup(makeAgent({}), () => 'wi_nr')
    const gen = await orchestrator.generate({
      repository: { owner: repo.owner, name: repo.name, githubId: repo.githubId },
      issue: { number: issue.number, githubId: issue.githubId, title: issue.title, url: issue.htmlUrl },
      intent: '补测试', workingDirectory: '/tmp/w',
    })
    expect(gen.kind).toBe('generated')
    const r = await orchestrator.reset('wi_nr')
    expect(r.ok).toBe(false)
  })
})
