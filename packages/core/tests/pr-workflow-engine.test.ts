/**
 * PRWorkflowEngine 单测（状态机纯逻辑，fail-closed 验证）。
 */
import { describe, it, expect } from 'vitest'
import { transition, isTerminal, canReset } from '../src/engines/contrib/pr-workflow-engine.js'

describe('transition', () => {
  it('candidate -> generate -> generating', () => {
    expect(transition({ from: 'candidate', action: 'generate' })).toEqual({ ok: true, to: 'generating' })
  })

  it('generating -> submit-for-review -> review', () => {
    expect(transition({ from: 'generating', action: 'submit-for-review' })).toEqual({ ok: true, to: 'review' })
  })

  it('review -> approve 必须绑定版本号', () => {
    expect(transition({ from: 'review', action: 'approve' }).ok).toBe(false)
    const ok = transition({ from: 'review', action: 'approve', version: 1 })
    expect(ok).toEqual({ ok: true, to: 'approved', approvedVersion: 1 })
  })

  it('approved -> publish -> publishing', () => {
    expect(transition({ from: 'approved', action: 'publish' })).toEqual({ ok: true, to: 'publishing' })
  })

  it('publishing -> publish-succeeded -> published', () => {
    expect(transition({ from: 'publishing', action: 'publish-succeeded' })).toEqual({ ok: true, to: 'published' })
  })

  it('publishing -> publish-failed -> failed', () => {
    expect(transition({ from: 'publishing', action: 'publish-failed' })).toEqual({ ok: true, to: 'failed' })
  })

  it('published -> revise -> revising', () => {
    expect(transition({ from: 'published', action: 'revise' })).toEqual({ ok: true, to: 'revising' })
  })

  it('revising -> publish -> publishing（发布后再改）', () => {
    expect(transition({ from: 'revising', action: 'publish' })).toEqual({ ok: true, to: 'publishing' })
  })

  it('published -> close -> closed', () => {
    expect(transition({ from: 'published', action: 'close' })).toEqual({ ok: true, to: 'closed' })
  })

  it('failed/discarded/closed -> reset -> candidate', () => {
    for (const s of ['failed', 'discarded', 'closed'] as const) {
      expect(transition({ from: s, action: 'reset' })).toEqual({ ok: true, to: 'candidate' })
    }
  })

  it('review -> discard -> discarded', () => {
    expect(transition({ from: 'review', action: 'discard' })).toEqual({ ok: true, to: 'discarded' })
  })

  it('review -> reject -> discarded', () => {
    expect(transition({ from: 'review', action: 'reject' })).toEqual({ ok: true, to: 'discarded' })
  })

  // === fail-closed：非法流转一律拒绝 ===
  it('非法流转被拒绝（candidate 不能直接 approved）', () => {
    const r = transition({ from: 'candidate', action: 'approve', version: 1 })
    expect(r.ok).toBe(false)
  })

  it('非法流转被拒绝（published 不能 generating）', () => {
    const r = transition({ from: 'published', action: 'generate' })
    expect(r.ok).toBe(false)
  })

  it('terminal 状态不可随意跳转（published 不能 reset）', () => {
    const r = transition({ from: 'published', action: 'reset' })
    expect(r.ok).toBe(false)
  })
})

describe('isTerminal / canReset', () => {
  it('published/closed/discarded/failed 为终态', () => {
    expect(isTerminal('published')).toBe(true)
    expect(isTerminal('closed')).toBe(true)
    expect(isTerminal('discarded')).toBe(true)
    expect(isTerminal('failed')).toBe(true)
    expect(isTerminal('review')).toBe(false)
  })

  it('仅 failed/discarded/closed 可 reset', () => {
    expect(canReset('failed')).toBe(true)
    expect(canReset('discarded')).toBe(true)
    expect(canReset('closed')).toBe(true)
    expect(canReset('review')).toBe(false)
    expect(canReset('approved')).toBe(false)
  })
})
