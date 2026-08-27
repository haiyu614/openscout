/**
 * AgentPort — Agent 编排接口
 *
 * 核心引擎通过此接口委托宿主 Agent 完成代码工作。
 * 不关心底层是 DSH subagent、Codex CLI 还是 OpenCode。
 */

export interface CodeWorkRequest {
  /** 给 Agent 的完整工作指令 */
  instruction: string
  /** 工作目录（已 clone 的仓库路径） */
  workingDirectory: string
  /** 超时毫秒数 */
  timeoutMs?: number
  /** 取消信号 */
  signal?: AbortSignal
  /** 可选：Agent 允许使用的工具白名单 */
  allowedTools?: string[]
  /** 可选：额外上下文（贡献规范、Issue 内容等） */
  context?: string
}

export interface ValidationResult {
  /** 验证命令 */
  command: string
  /** 是否通过 */
  passed: boolean
  /** 输出摘要 */
  output?: string
  /** 失败原因 */
  error?: string
}

export interface CodeWorkResult {
  /** 是否成功完成 */
  success: boolean
  /** Agent 产出的文件变更列表 */
  changedFiles?: string[]
  /** Agent 执行的验证结果 */
  validationResults?: ValidationResult[]
  /** 失败原因 */
  failureReason?: string
  /** Agent 的自然语言总结 */
  summary?: string
  /** 生成的 diff（unified format） */
  diff?: string
}

export interface AgentPort {
  /**
   * 委托 Agent 完成一段代码工作。
   * 核心只描述意图和约束，不关心 Agent 内部实现。
   */
  delegateCodeWork(request: CodeWorkRequest): Promise<CodeWorkResult>
}
