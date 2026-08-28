/**
 * ContribOrchestrator.approve 单测（review → approved 审批闸门）。
 */
import { describe, it, expect } from 'vitest'
import { ContribOrchestrator } from '../src/engines/contrib/orchestrator.js'
import { DedupEngine } from '../src/engines/dedup.js'
import { InMemoryStorage } from '@openscout/storage-memory'
import { fixedClock } from './mocks.js'
import type { AgentPort, CodeWorkResult, ApprovalPort, ApprovalOutcome } from '../src/ports/agent.js'

function makeAgent(): AgentPort {
  return { async delegateCodeWork() { return { success: true, changedFiles: ['a.ts'], validationResults: [], summary: 's', diff: 'd' } as CodeWorkResult } }
}

function setup(approval: ApprovalPort, idGen?: () => string) {
  const storage = new InMemoryStorage()
  const dedup = new DedupEngine({ storage, clock: fixedClock('2026-01-01T00:00:00Z') })
  const orch = new ContribOrchestrator({ storage, dedup, agent: makeAgent(), approval, clock: fixedClock('2026-01-01T00:00:00Z'), idGenerator: idGen ?? (() => 'wi_1') })
  return { storage, orch }
}

const repo = { owner: 'octocat', name: 'repo', githubId: 42 }
const issue = { number: 5, githubId: 99, title: 'Add tests', url: 'https://github.com/octocat/repo/issues/5' }

describe('ContribOrchestrator.approve', () => {
  it('review 状态经批准后进入 approved，绑定 approvedVersion', async () => {
    const approval: ApprovalPort = { async requestApproval() { return 'approved' as ApprovalOutcome } }
    const { storage, orch } = setup(approval)
    const gen = await orch.generate({ repository: repo, issue, intent: '补测试', workingDirectory: '/tmp/w' })
    expect(gen.kind).toBe('generated')
    const r = await orch.approve('wi_1')
    expect(r.ok).toBe(true)
    const rec = storage.prWorkItems.get('wi_1') as { status: string; approvedVersion: number }
    expect(rec.status).toBe('approved')
    expect(rec.approvedVersion).toBe(1)
  })

  it('审批不可用 → 拒绝且不推进', async () => {
    const approval: ApprovalPort = { async requestApproval() { return 'unavailable' as ApprovalOutcome } }
    const { storage, orch } = setup(approval)
    const gen = await orch.generate({ repository: repo, issue, intent: '补测试', workingDirectory: '/tmp/w' })
    expect(gen.kind).toBe('generated')
    const r = await orch.approve('wi_1')
    expect(r.ok).toBe(false)
    const rec = storage.prWorkItems.get('wi_1') as { status: string }
    expect(rec.status).toBe('review')
  })

  it('未配置 ApprovalPort → 拒绝', async () => {
    const { storage, orch } = setup(undefined as unknown as ApprovalPort)
    const gen = await orch.generate({ repository: repo, issue, intent: '补测试', workingDirectory: '/tmp/w' })
    expect(gen.kind).toBe('generated')
    const r = await orch.approve('wi_1')
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('ApprovalPort')
  })

  it('非 review 状态不可 approve', async () => {
    const approval: ApprovalPort = { async requestApproval() { return 'approved' as ApprovalOutcome } }
    const { orch } = setup(approval)
    const r = await orch.approve('不存在')
    expect(r.ok).toBe(false)
  })
})
