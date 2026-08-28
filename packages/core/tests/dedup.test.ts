import { describe, it, expect } from 'vitest'
import { DedupEngine } from '../src/engines/dedup.js'
import { issueDeduplicationKey, intentFingerprint } from '../src/models/dedup.js'
import { InMemoryStorage, makeMockGithub, makeIssue, makeRepo } from './mocks.js'
import { fixedClock } from './mocks.js'

const NOW = '2024-06-15T00:00:00Z'

describe('DedupEngine - 规则 1/2/6 本地注册表', () => {
  it('规则 1：Issue 主键已存在活跃记录 → 重复', async () => {
    const storage = new InMemoryStorage()
    const engine = new DedupEngine({ storage, clock: fixedClock(NOW) })
    const key = issueDeduplicationKey(1, 100)
    await engine.register({ key, workItemId: 'wi-1', taskId: 'task-a' })

    const decision = engine.checkLocal({ key, taskId: 'task-b' })
    expect(decision.duplicate).toBe(true)
    if (decision.duplicate) expect(decision.reason).toContain('跨任务')
  })

  it('规则 2：同任务命中已存在活跃记录 → 幂等重复', async () => {
    const storage = new InMemoryStorage()
    const engine = new DedupEngine({ storage, clock: fixedClock(NOW) })
    const key = issueDeduplicationKey(1, 101)
    await engine.register({ key, workItemId: 'wi-2', taskId: 'task-a' })

    const decision = engine.checkLocal({ key, taskId: 'task-a' })
    expect(decision.duplicate).toBe(true)
    if (decision.duplicate) expect(decision.reason).toContain('幂等')
  })

  it('规则 5：意图指纹命中活跃记录 → 重复', async () => {
    const storage = new InMemoryStorage()
    const engine = new DedupEngine({ storage, clock: fixedClock(NOW) })
    const fp = intentFingerprint({ repoGithubId: 1, baseline: 'main', intent: 'add dark mode', changeFingerprint: 'abc' })
    await engine.register({ key: issueDeduplicationKey(1, 200), workItemId: 'wi-3', taskId: 'task-a', intentFingerprint: fp })

    const decision = engine.checkLocal({ key: issueDeduplicationKey(1, 999), taskId: 'task-b', intentFingerprint: fp })
    expect(decision.duplicate).toBe(true)
    expect(decision.reason).toContain('意图去重')
  })

  it('规则 6：墓碑记录默认不重复生成', async () => {
    const storage = new InMemoryStorage()
    const engine = new DedupEngine({ storage, clock: fixedClock(NOW) })
    const key = issueDeduplicationKey(1, 300)
    await engine.register({ key, workItemId: 'wi-4', taskId: 'task-a' })
    await engine.tombstone(key, 'user-rejected')

    const decision = engine.checkLocal({ key, taskId: 'task-b' })
    expect(decision.duplicate).toBe(true)
    expect(decision.reason).toContain('墓碑')
  })

  it('规则 6：显式 restore 后允许重新生成', async () => {
    const storage = new InMemoryStorage()
    const engine = new DedupEngine({ storage, clock: fixedClock(NOW) })
    const key = issueDeduplicationKey(1, 301)
    await engine.register({ key, workItemId: 'wi-5', taskId: 'task-a' })
    await engine.tombstone(key, 'closed')
    await engine.restore(key)

    const decision = engine.checkLocal({ key, taskId: 'task-a' })
    expect(decision.duplicate).toBe(false)
  })
})

describe('DedupEngine - 规则 3 运行幂等', () => {
  it('同 runId + 同 key 复用记录而非新建', async () => {
    const storage = new InMemoryStorage()
    const engine = new DedupEngine({ storage, clock: fixedClock(NOW) })
    const key = issueDeduplicationKey(1, 400)
    const r1 = await engine.register({ key, workItemId: 'wi-6', taskId: 'task-a', runId: 'run-1' })
    const r2 = await engine.register({ key, workItemId: 'wi-6b', taskId: 'task-a', runId: 'run-1' })
    expect(r2.workItemId).toBe(r1.workItemId)
    expect(storage.dedup.size).toBe(1)
  })
})

describe('DedupEngine - 规则 4/8 远端事实', () => {
  it('规则 4：Issue 已有关联 PR → 重复', () => {
    const storage = new InMemoryStorage()
    const engine = new DedupEngine({ storage, github: makeMockGithub() })
    const issue = makeIssue()
    const decision = engine.checkRemote(issue, { relatedPRs: [{ number: 1, state: 'open' }] })
    expect(decision.duplicate).toBe(true)
    if (decision.duplicate) expect(decision.reason).toContain('关联 PR')
  })

  it('规则 4：用户已有 fork 分支 → 重复', () => {
    const storage = new InMemoryStorage()
    const engine = new DedupEngine({ storage, github: makeMockGithub() })
    const issue = makeIssue()
    const decision = engine.checkRemote(issue, { existingUserBranches: ['openscout/fix-1'] })
    expect(decision.duplicate).toBe(true)
  })

  it('规则 4：无任何远端事实 → 不重复', () => {
    const storage = new InMemoryStorage()
    const engine = new DedupEngine({ storage, github: makeMockGithub() })
    const issue = makeIssue()
    const decision = engine.checkRemote(issue, { relatedPRs: [], existingUserBranches: [] })
    expect(decision.duplicate).toBe(false)
  })

  it('checkAll 先本地后远端', async () => {
    const storage = new InMemoryStorage()
    const engine = new DedupEngine({ storage, github: makeMockGithub() })
    const key = issueDeduplicationKey(1, 500)
    await engine.register({ key, workItemId: 'wi-7', taskId: 'task-a' })
    const decision = await engine.checkAll(
      { key, taskId: 'task-b' },
      { issue: makeIssue(), facts: { relatedPRs: [] } },
    )
    expect(decision.duplicate).toBe(true)
    expect(decision.reason).toContain('跨任务')
  })

  it('checkAll 本地无重复且无远端 facts 时返回不重复', async () => {
    const storage = new InMemoryStorage()
    const engine = new DedupEngine({ storage, github: makeMockGithub() })
    const key = issueDeduplicationKey(1, 510)
    const decision = await engine.checkAll({ key, taskId: 'task-a' })
    expect(decision.duplicate).toBe(false)
  })

  it('checkRemote 接收 repoMeta 不影响判定', () => {
    const storage = new InMemoryStorage()
    const engine = new DedupEngine({ storage, github: makeMockGithub() })
    const issue = makeIssue()
    const decision = engine.checkRemote(issue, { relatedPRs: [] }, makeRepo({ githubId: 1 }))
    expect(decision.duplicate).toBe(false)
  })
})

describe('DedupEngine - 查询辅助', () => {
  it('findActiveByIssueKey 找到活跃工作项', async () => {
    const storage = new InMemoryStorage()
    const engine = new DedupEngine({ storage, clock: fixedClock(NOW) })
    const key = issueDeduplicationKey(1, 600)
    await engine.register({ key, workItemId: 'wi-8', taskId: 'task-a' })
    expect(engine.findActiveByIssueKey(key)?.workItemId).toBe('wi-8')
  })

  it('register 写入带时间戳的记录', async () => {
    const storage = new InMemoryStorage()
    const engine = new DedupEngine({ storage, clock: fixedClock(NOW) })
    const key = issueDeduplicationKey(1, 601)
    const rec = await engine.register({ key, workItemId: 'wi-9', taskId: 'task-a' })
    expect(rec.createdAt).toBe('2024-06-15T00:00:00.000Z')
    expect(rec.status).toBe('active')
  })
})
