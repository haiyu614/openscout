/**
 * DSH credentials → Core CredentialPort 适配器。
 *
 * Core 只声明 `resolveGitHubToken()`，不关心 Token 来自环境变量、.env 还是
 * DSH 凭证源。此处委托注入的 `resolve` 闭包（由插件绑定 `ctx.credentials.resolve`），
 * 每次操作重新解析，因此凭证热轮换对下一次调用自动生效，无需重启插件。
 */

import type { CredentialPort } from '@openscout/core'

/** 默认 GitHub Token 凭据引用名（与 DSH credential 源一致）。 */
export const GITHUB_TOKEN_REF = 'GITHUB_TOKEN'

export class DshCredentialPort implements CredentialPort {
  constructor(
    private readonly resolve: (ref: string) => Promise<{ value: string } | undefined>,
    private readonly ref: string = GITHUB_TOKEN_REF,
  ) {}

  async resolveGitHubToken(): Promise<string | undefined> {
    const resolved = await this.resolve(this.ref)
    return resolved?.value
  }
}
