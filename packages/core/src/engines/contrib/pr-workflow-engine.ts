/**
 * PRWorkflowEngine — PR 工作项状态机（纯逻辑）。
 *
 * 覆盖 PRWorkItemStatus 的 10 状态及其合法流转。状态机只判定「是否允许流转」
 * 与「流转后的目标状态」，不接触存储/网络/审批；持久化由编排层负责。
 *
 * fail-closed：未知/非法流转一律拒绝，绝不静默放行。
 */

import { PRWorkItemStatus } from '../../models/pr-work-item.js'

/** 一次状态流转请求。 */
export interface TransitionRequest {
  from: PRWorkItemStatus
  /** 意图动作；显式语义，避免歧义 */
  action:
    | 'generate'      // 开始生成贡献包
    | 'submit-for-review' // 生成完成，提交审阅
    | 'approve'       // 用户批准当前版本
    | 'reject'        // 用户拒绝（转墓碑）
    | 'publish'       // 开始发布到 GitHub
    | 'publish-succeeded' // 已创建远端 PR
    | 'publish-failed' // 发布失败
    | 'revise'        // 远端 PR 创建后继续修改
    | 'discard'       // 用户删除本地草案
    | 'close'         // 远端 PR 关闭
    | 'fail'          // 生成/发布失败（非发布阶段）
    | 'reset'         // 从终态回到候选（重新生成）
  /** 关联版本号（approve 时绑定） */
  version?: number
}

/** 流转结果：成功给出目标状态，失败给出原因（fail-closed）。 */
export type TransitionResult =
  | { ok: true; to: PRWorkItemStatus; approvedVersion?: number }
  | { ok: false; reason: string }

/** 合法的 (from, action) → to 映射表。未列出的组合全部非法。 */
const TRANSITIONS: ReadonlyMap<string, PRWorkItemStatus> = new Map<string, PRWorkItemStatus>([
  ['candidate:generate', 'generating'],
  ['generating:submit-for-review', 'review'],
  ['generating:fail', 'failed'],
  ['review:approve', 'approved'],
  ['review:discard', 'discarded'],
  ['review:reject', 'discarded'],
  ['approved:publish', 'publishing'],
  ['publishing:publish-succeeded', 'published'],
  ['publishing:publish-failed', 'failed'],
  ['publishing:fail', 'failed'],
  ['published:revise', 'revising'],
  ['revising:publish', 'publishing'],
  ['revising:revise', 'revising'],
  ['revising:close', 'closed'],
  ['published:close', 'closed'],
  ['failed:reset', 'candidate'],
  ['discarded:reset', 'candidate'],
  ['closed:reset', 'candidate'],
])

/** 终态集合：进入后需 reset 才能再次流转。 */
const TERMINAL: ReadonlySet<PRWorkItemStatus> = new Set<PRWorkItemStatus>([
  'published',
  'closed',
  'discarded',
  'failed',
])

/**
 * 计算一次状态流转的结果。
 * @param req - 流转请求
 * @returns 成功含目标状态（approve 时含 approvedVersion），失败含原因
 */
export function transition(req: TransitionRequest): TransitionResult {
  const key = `${req.from}:${req.action}`
  const to = TRANSITIONS.get(key)
  if (to === undefined) {
    return { ok: false, reason: `非法流转: ${req.from} --${req.action}--> ?` }
  }
  if (req.action === 'approve') {
    const v = req.version
    if (v === undefined || v < 1) {
      return { ok: false, reason: 'approve 必须绑定版本号（boundVersion >= 1）' }
    }
    return { ok: true, to, approvedVersion: v }
  }
  return { ok: true, to }
}

/** 判定某状态是否为终态。 */
export function isTerminal(status: PRWorkItemStatus): boolean {
  return TERMINAL.has(status)
}

/**
 * 判定从某状态能否被「重新生成」（reset）。
 * 仅 failed / discarded / closed 允许 reset，保持 resume 语义收敛。
 */
export function canReset(status: PRWorkItemStatus): boolean {
  return status === 'failed' || status === 'discarded' || status === 'closed'
}
