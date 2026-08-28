/**
 * DSH 模型可见工具：approve / publish。
 *
 * 编排 Core 的 ContribOrchestrator.approve 与 PublishEngine.publish。
 * 发布所需的文件字节（Commit[]）由调用方（Agent 工作区产出）提供——
 * Core 不持有文件系统，符合端口/适配器边界（详见 publish-engine.ts 说明）。
 *
 * 工具体只做「参数 → Core 引擎 → 可解释结果」，无核心业务逻辑重复。
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  ContribOrchestrator,
  PublishEngine,
  PRWorkItemRecord,
} from '@openscout/core'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

/** 注册审批/发布工具，返回卸载函数。 */
export function registerPublishingTools(
  orchestrator: ContribOrchestrator,
  publishEngine: PublishEngine,
  register: (def: ToolDefinition) => () => void,
): Array<() => void> {
  const approve = defineTool({
    name: 'openscout_approve',
    description:
      '请求用户审批一个处于 review 状态的贡献包（版本绑定，fail-closed）。' +
      '审批通过后将工作项推进到 approved，绑定 approvedVersion。',
    parameters: {
      workItemId: { type: 'string', required: true },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    timeoutMs: 120_000,
    execute: async (args) => {
      const a = args as { workItemId: string }
      const res = await orchestrator.approve(a.workItemId)
      if (!res.ok) return { approved: false, reason: res.reason }
      return { approved: true, to: res.to, approvedVersion: res.approvedVersion }
    },
  })

  const publish = defineTool({
    name: 'openscout_publish',
    description:
      '将已 approved 的贡献包发布为 GitHub 草稿 PR。' +
      'files 为 Agent 工作区产出的文件内容（path + content）；Core 不读文件系统。',
    parameters: {
      workItemId: { type: 'string', required: true },
      files: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            content: { type: 'string' },
          },
          additionalProperties: false,
        },
      },
      asDraft: { type: 'boolean' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    timeoutMs: 120_000,
    execute: async (args) => {
      const a = args as {
        workItemId: string
        files?: Array<{ path: string; content: string }>
        asDraft?: boolean
      }
      const commits = a.files && a.files.length > 0
        ? [{ message: 'OpenScout contribution', files: a.files }]
        : []
      const res = await publishEngine.publish({
        workItemId: a.workItemId,
        commits,
        asDraft: a.asDraft ?? true,
      })
      if (!res.ok) return { published: false, reason: res.reason, status: res.workItem.status }
      return {
        published: true,
        status: res.workItem.status,
        remotePR: res.remotePR,
        draft: res.draft,
      }
    },
  })

  // 健康检查：确认 Core 类型可用（编译期契约）
  void PRWorkItemRecord

  const disposeApprove = register(approve)
  const disposePublish = register(publish)
  return [disposeApprove, disposePublish]
}
