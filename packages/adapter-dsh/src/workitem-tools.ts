/**
 * DSH 模型可见工具：PR 工作项多轮操作（M6）。
 *
 * 由 `defineTool` 声明并注册到 `ctx.tools`。工具体只做「参数 → Core
 * ContribOrchestrator / DedupEngine → 可解释结果」编排；状态机/版本/去重逻辑
 * 全部在 @openscout/core，零重复。
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  ContribOrchestrator,
  type PRWorkItemRecord,
} from '@openscout/core'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

export interface WorkItemToolsDeps {
  orchestrator: ContribOrchestrator
}

/** 注册多轮工作项工具，返回卸载函数列表。 */
export function registerWorkItemTools(
  deps: WorkItemToolsDeps,
  register: (def: ToolDefinition) => () => void,
): Array<() => void> {
  const { orchestrator } = deps

  const revise = defineTool({
    name: 'openscout_revise',
    description:
      '多轮协作：将工作项重新打开进行新一轮修改（review/approved/published/revising → revising → review）。' +
      '版本号递增，构建新版本审阅包。需提供额外指令（可选）。',
    parameters: {
      workItemId: { type: 'string', required: true },
      instruction: { type: 'string' },
    },
    output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
    timeoutMs: 120_000,
    execute: async (args) => {
      const a = args as { workItemId: string; instruction?: string }
      const res = await orchestrator.revise(a.workItemId, a.instruction)
      if (res.kind === 'generated') {
        return { revised: true, workItemId: res.workItem.id, status: res.workItem.status, version: res.version }
      }
      return { revised: false, reason: res.reason, workItemId: a.workItemId }
    },
  })

  const listWorkItems = defineTool({
    name: 'openscout_list_workitems',
    description: '列出全部 PR 工作项（按更新时间倒序），含状态与版本号。',
    parameters: {},
    output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
    timeoutMs: 30_000,
    execute: async () => {
      const items: PRWorkItemRecord[] = orchestrator.listWorkItems()
      return items.map((it) => ({
        id: it.id,
        status: it.status,
        currentVersion: it.currentVersion,
        approvedVersion: it.approvedVersion,
        repository: `${it.repository.owner}/${it.repository.name}`,
        issue: it.issue?.number,
        remotePR: it.remotePR?.number,
      }))
    },
  })

  const resetWorkItem = defineTool({
    name: 'openscout_reset_workitem',
    description: '将失败/丢弃/已关闭的工作项重置回候选（重新生成）。',
    parameters: { workItemId: { type: 'string', required: true } },
    output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
    timeoutMs: 30_000,
    execute: async (args) => {
      const a = args as { workItemId: string }
      const res = await orchestrator.reset(a.workItemId)
      if (!res.ok) return { reset: false, reason: res.reason }
      return { reset: true, to: res.to }
    },
  })

  return [revise, listWorkItems, resetWorkItem].map((def) => register(def))
}
