/**
 * ShellPort — 命令执行接口
 *
 * 核心引擎通过此接口执行 shell 命令（git clone、npm test 等）。
 */

export interface ShellOptions {
  /** 工作目录 */
  cwd?: string
  /** 环境变量 */
  env?: Record<string, string>
  /** 超时毫秒数 */
  timeoutMs?: number
  /** 取消信号 */
  signal?: AbortSignal
}

export interface ShellResult {
  /** 退出码 */
  exitCode: number
  /** stdout 内容 */
  stdout: string
  /** stderr 内容 */
  stderr: string
}

export interface ShellPort {
  /** 执行命令 */
  execute(command: string, options?: ShellOptions): Promise<ShellResult>
}
