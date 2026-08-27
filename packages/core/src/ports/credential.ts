/**
 * CredentialPort — 凭据接口
 *
 * 核心引擎通过此接口获取 GitHub Token。
 * 不关心底层是环境变量、DSH ctx.credentials 还是密钥管理器。
 */

export interface CredentialPort {
  /** 解析 GitHub Token，每次操作重新解析（支持热轮换） */
  resolveGitHubToken(): Promise<string | undefined>
}
