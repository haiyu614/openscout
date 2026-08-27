/**
 * ApprovalPort — 审批接口
 *
 * 核心引擎通过此接口请求用户对危险操作的批准。
 * 不关心底层是 DSH approval waterfall、终端 prompt 还是 Web UI。
 */

export interface ApprovalRequest {
  /** 操作类型（用于 UI 展示和审计） */
  action: string
  /** 操作详情 */
  details: {
    /** 目标仓库 */
    repository?: string
    /** 关联 Issue */
    issue?: string
    /** 要执行的远端动作描述 */
    operations?: string[]
    /** PR 标题 */
    prTitle?: string
    /** 其他信息 */
    [key: string]: unknown
  }
  /** 关联的 PR 工作项 ID */
  workItemId?: string
  /** 绑定的版本号：任何实质变更自动失效 */
  boundVersion?: number
}

export type ApprovalOutcome =
  | 'approved'
  | 'rejected'
  | 'cancelled'
  | 'unavailable'

export interface ApprovalPort {
  /**
   * 请求用户对一个操作的批准。
   * 实现必须 fail-closed：无法联系用户时返回 'unavailable'。
   */
  requestApproval(request: ApprovalRequest): Promise<ApprovalOutcome>
}
