/**
 * DSH ApprovalPort 适配器。
 *
 * 将 DSH 的审批设施（若存在）桥接为 Core 的 ApprovalPort。
 * 若宿主未提供审批设施，则 fail-closed 返回 'unavailable'（绝不静默放行），
 * 与 Core ApprovalGate 的 fail-closed 语义一致。
 */

import type { ApprovalPort, ApprovalRequest, ApprovalOutcome } from '@openscout/core'

/** DSH 审批设施的最小接口（由宿主运行时提供）。 */
export interface DshApprovalFacility {
  requestApproval(req: ApprovalRequest): Promise<ApprovalOutcome>
}

export type ApprovalResolver = () => DshApprovalFacility | undefined

/** 构造 Core ApprovalPort：有设施则委托，无则 fail-closed。 */
export class DshApprovalPort implements ApprovalPort {
  constructor(private readonly resolve: ApprovalResolver) {}

  async requestApproval(req: ApprovalRequest): Promise<ApprovalOutcome> {
    const facility = this.resolve()
    if (!facility) return 'unavailable'
    return facility.requestApproval(req)
  }
}
