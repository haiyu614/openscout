/**
 * ApprovalGate 单测（纯逻辑，fail-closed 验证）。
 */
import { describe, it, expect } from 'vitest'
import {
  requestApproval,
  isApprovalValid,
} from '../src/engines/contrib/approval-gate.js'
import type { ApprovalPort, ApprovalOutcome } from '../src/ports/approval.js'

function mockApproval(behave: ApprovalOutcome): ApprovalPort {
  return { async requestApproval() { return behave } }
}

describe('requestApproval', () => {
  it('审批不可用（unavailable）→ fail-closed 拒绝', async () => {
    const r = await requestApproval(mockApproval('unavailable'), {
      action: 'publish-pr', workItemId: 'wi_1', currentStatus: 'review',
      version: 1, approvedVersion: undefined,
    })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('联系不到用户')
  })

  it('用户拒绝 → 拒绝（未带 approvedVersion 强制委托宿主）', async () => {
    const r = await requestApproval(mockApproval('rejected'), {
      action: 'publish-pr', workItemId: 'wi_1', currentStatus: 'review',
      version: 1, approvedVersion: undefined,
    })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('拒绝')
  })

  it('已批准且版本一致 → 直接放行（不委托宿主）', async () => {
    let calls = 0
    const port = { async requestApproval() { calls++; return 'approved' as const } }
    const r = await requestApproval(port as unknown as ApprovalPort, {
      action: 'publish-pr', workItemId: 'wi_1', currentStatus: 'approved',
      version: 2, approvedVersion: 2,
    })
    expect(r.ok).toBe(true)
    expect(calls).toBe(0) // 版本一致时不打扰用户
  })

  it('版本漂移（approvedVersion ≠ version）→ 委托宿主重新审批', async () => {
    let captured: { boundVersion?: number } | null = null
    const port = {
      async requestApproval(req: { boundVersion?: number }) { captured = req; return 'approved' as const },
    }
    const r = await requestApproval(port as unknown as ApprovalPort, {
      action: 'publish-pr', workItemId: 'wi_1', currentStatus: 'review',
      version: 3, approvedVersion: 1,
    })
    expect(r.ok).toBe(true)
    expect(captured?.boundVersion).toBe(3) // 绑定的必须是当前 version
  })
})

describe('isApprovalValid', () => {
  it('版本一致有效、缺省无效、漂移无效', () => {
    expect(isApprovalValid(1, 1)).toBe(true)
    expect(isApprovalValid(undefined, 1)).toBe(false)
    expect(isApprovalValid(2, 5)).toBe(false)
  })
})
