/**
 * DshCredentialPort 测试：验证每次解析 GitHub Token，并支持热轮换。
 * DSH credentials 模块以 vi.mock 打桩。
 */

import { describe, it, expect, vi } from 'vitest'
import { DshCredentialPort, GITHUB_TOKEN_REF } from '../src/credential.js'

describe('DshCredentialPort', () => {
  it('resolves the GitHub token via the injected resolver', async () => {
    const resolve = vi.fn(async (ref: string) => {
      expect(ref).toBe(GITHUB_TOKEN_REF)
      return { value: 'tok-123' }
    })
    const port = new DshCredentialPort(resolve)
    expect(await port.resolveGitHubToken()).toBe('tok-123')
    expect(resolve).toHaveBeenCalledTimes(1)
  })

  it('returns undefined when no credential is configured', async () => {
    const resolve = vi.fn(async () => undefined)
    const port = new DshCredentialPort(resolve)
    expect(await port.resolveGitHubToken()).toBeUndefined()
  })

  it('reflects token rotation on the next call', async () => {
    let tok = 'old'
    const resolve = vi.fn(async () => ({ value: tok }))
    const port = new DshCredentialPort(resolve)
    expect(await port.resolveGitHubToken()).toBe('old')
    tok = 'new'
    expect(await port.resolveGitHubToken()).toBe('new')
  })

  it('honors a custom ref name', async () => {
    const resolve = vi.fn(async (ref: string) => {
      expect(ref).toBe('CUSTOM_GH')
      return { value: 'v' }
    })
    const port = new DshCredentialPort(resolve, 'CUSTOM_GH')
    expect(await port.resolveGitHubToken()).toBe('v')
  })
})
