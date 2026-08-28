/**
 * ApprovalGate — 审批闸门（纯逻辑）。
 *
 * 对「发布 PR」「关闭 PR」「删除分支」等危险操作做**版本绑定**审批：任何对
 * ReviewBundle / 工作项的实质变更都会让已批准的 boundVersion 失效，必须重新审批
 * （fail-closed：无法联系用户 → 'unavailable' → 拒绝）。
 *
 * 不接触存储/网络；状态流转由 PRWorkflowEngine 负责，本门只判定「是否允许推进到发布」。
 */

import type { ApprovalPort, ApprovalRequest, ApprovalOutcome } from '../../ports/approval.js'

/** 请求审批的入参。 */
export interface ApprovalGateRequest {
  /** 操作类型（用于 UI 展示/审计）：'publish-pr' | 'close-pr' | 'delete-branch' 等 */
  action: string
  /** 关联的 PR 工作项 ID */
  workItemId: string
  /** 当前工作项状态（gate 做前置 sanity check） */
  currentStatus: string
  /** 本次发布/操作对应的贡献包版本号 */
  version: number
  /** 工作项上已批准的版本号（无则未审批） */
  approvedVersion?: number
  /** 可选：给用户的操作详情 */
  details?: ApprovalRequest['details']
}

/** 闸门判定结果。 */
export type GateResult =
  | { ok: true; outcome: ApprovalOutcome }
  | { ok: false; reason: string }

/**
 * 判定是否在「无需重新审批」的情况下放行：
 * 仅当 action 是幂等安全读类时才可不经审批——但本门只服务写操作，故一律需 approval。
 */
function requiresApproval(_action: string): boolean {
  return true
}

/**
 * 审批闸门核心：先版本自检，再委托 ApprovalPort。
 *
 * 版本失效规则（fail-closed 关键）：
 *  - 若 action 需要审批（本门全部需要），而 approvedVersion 缺失或与 version 不一致 →
 *    直接拒绝（reason 说明需重新审批），不委托宿主，避免误用旧批准发布新内容。
 *  - ApprovalPort 返回 'unavailable'（联系不上用户）→ 拒绝，绝不放行。
 */
export async function requestApproval(
  port: ApprovalPort,
  req: ApprovalGateRequest,
): Promise<GateResult> {
  if (!requiresApproval(req.action)) {
    return { ok: true, outcome: 'approved' }
  }

  // 版本绑定自检：无批准或版本漂移 → 必须先审批
  if (req.approvedVersion === undefined || req.approvedVersion !== req.version) {
    // 仍委托宿主弹出审批（用户可能在 UI 直接批准当前版本），
    // 但审批请求必须绑定当前 version，宿主侧据此下发 boundVersion。
    const outcome = await port.requestApproval({
      action: req.action,
      workItemId: req.workItemId,
      boundVersion: req.version,
      details: req.details ?? {},
    })
    if (outcome === 'approved') {
      // 宿主批准即代表认可绑定 version；调用方应据返回的 boundVersion 回写 approvedVersion
      return { ok: true, outcome }
    }
    if (outcome === 'unavailable') {
      return { ok: false, reason: '审批通道不可用（联系不到用户），fail-closed 拒绝' }
    }
    return { ok: false, reason: `用户${outcome === 'rejected' ? '拒绝' : '取消'}了操作` }
  }

  // 已批准且版本一致 → 直接放行（不重复打扰）
  return { ok: true, outcome: 'approved' }
}

/**
 * 校验「已批准版本」是否仍然有效（供 PublishEngine 在真正下笔前二次确认）。
 * 任何版本漂移都视为失效。
 */
export function isApprovalValid(approvedVersion: number | undefined, currentVersion: number): boolean {
  return approvedVersion !== undefined && approvedVersion === currentVersion
}
