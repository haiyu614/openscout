/**
 * M4 DSH 适配器测试：DshApprovalPort 与 registerPublishingTools 的接线正确性。
 * DSH 模块以 vi.mock 打桩（与 M2 适配层测试一致）。
 */

import { describe, it, expect, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-tools', () => ({
  defineTool: (opts: { name: string; execute: (a: unknown) => Promise<unknown> }) => ({
    name: opts.name,
    execute: opts.execute,
  }),
}))

import { DshApprovalPort, type DshApprovalFacility } from '../src/approval.js'
import { registerPublishingTools } from '../src/publishing-tools.js'
import type { ApprovalPort } from '@openscout/core'

describe('DshApprovalPort', () => {
  it('无审批设施 → fail-closed 返回 unavailable', async () => {
    const port = new DshApprovalPort(() => undefined)
    expect(await port.requestApproval({ action: 'x', details: {} })).toBe('unavailable')
  })

  it('有设施 → 委托并透传结果', async () => {
    const facility: DshApprovalFacility = {
      async requestApproval(req) { return 'approved' as never },
    }
    void facility
    const spy = vi.fn(async () => 'rejected' as never)
    const port = new DshApprovalPort(() => ({ requestApproval: spy } as DshApprovalFacility))
    const r = await port.requestApproval({ action: 'publish-pr', details: {}, workItemId: 'wi_1' })
    expect(r).toBe('rejected')
    expect(spy).toHaveBeenCalledOnce()
  })
})

describe('registerPublishingTools', () => {
  it('注册 openscout_approve / openscout_publish 两个工具', () => {
    const registered: string[] = []
    const orchestrator = {
      async approve(id: string) { return { ok: true, to: 'approved', approvedVersion: 1 } as never },
    }
    const publishEngine = {
      async publish(_req: unknown) { return { ok: true, workItem: { status: 'published' }, remotePR: { number: 1, url: 'u' }, draft: true } as never },
    }
    const disposers = registerPublishingTools(
      orchestrator as never,
      publishEngine as never,
      (def) => { registered.push(def.name); return () => {} },
    )
    expect(registered).toContain('openscout_approve')
    expect(registered).toContain('openscout_publish')
    expect(disposers).toHaveLength(2)
  })

  it('openscout_approve 工具委托 orchestrator.approve', async () => {
    const spy = vi.fn(async () => ({ ok: true, to: 'approved', approvedVersion: 1 } as never))
    const orchestrator = { approve: spy }
    let approveTool: { execute: (a: unknown) => Promise<unknown> } | undefined
    registerPublishingTools(orchestrator as never, { async publish() { return {} as never } } as never, (def) => {
      if (def.name === 'openscout_approve') approveTool = def as never
      return () => {}
    })
    const res = await approveTool!.execute({ workItemId: 'wi_x' })
    expect(spy).toHaveBeenCalledWith('wi_x')
    expect((res as { approved: boolean }).approved).toBe(true)
  })

  it('openscout_publish 工具委托 publishEngine.publish 并构造 commits', async () => {
    const spy = vi.fn(async () => ({ ok: true, workItem: { status: 'published' }, remotePR: { number: 2, url: 'u' }, draft: true } as never))
    const publishEngine = { publish: spy }
    let pubTool: { execute: (a: unknown) => Promise<unknown> } | undefined
    registerPublishingTools({ async approve() { return {} as never } } as never, publishEngine as never, (def) => {
      if (def.name === 'openscout_publish') pubTool = def as never
      return () => {}
    })
    const res = await pubTool!.execute({ workItemId: 'wi_y', files: [{ path: 'a.ts', content: 'x' }], asDraft: true })
    expect(spy).toHaveBeenCalledOnce()
    const arg = spy.mock.calls[0]![0] as { workItemId: string; commits: Array<{ files: Array<{ path: string }> }>; asDraft: boolean }
    expect(arg.workItemId).toBe('wi_y')
    expect(arg.commits[0].files[0].path).toBe('a.ts')
    expect(arg.asDraft).toBe(true)
    expect((res as { published: boolean }).published).toBe(true)
  })

  it('缺 files 时发布仍委托（commits 为空数组）', async () => {
    const spy = vi.fn(async () => ({ ok: true, workItem: { status: 'published' }, remotePR: { number: 3, url: 'u' }, draft: true } as never))
    let pubTool: { execute: (a: unknown) => Promise<unknown> } | undefined
    registerPublishingTools({ async approve() { return {} as never } } as never, { publish: spy } as never, (def) => {
      if (def.name === 'openscout_publish') pubTool = def as never
      return () => {}
    })
    await pubTool!.execute({ workItemId: 'wi_z' })
    const arg = spy.mock.calls[0]![0] as { commits: unknown[] }
    expect(arg.commits).toEqual([])
  })
})

// 保持 ApprovalPort 类型被引用（编译契约）
export type { ApprovalPort }
