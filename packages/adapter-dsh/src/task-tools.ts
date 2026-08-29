/**
 * DSH 模型可见工具：定时任务管理（M5）。
 *
 * 由 `defineTool` 声明并注册到 `ctx.tools`。工具体只做「参数 → Core TaskEngine /
 * SchedulerEngine → 可解释结果」编排，状态机/配额逻辑全部在 @openscout/core。
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  TaskEngine,
  SchedulerEngine,
} from '@openscout/core'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

export interface TaskToolsDeps {
  taskEngine: TaskEngine
  schedulerEngine: SchedulerEngine
}

/** 注册任务管理工具，返回卸载函数列表。 */
export function registerTaskTools(
  deps: TaskToolsDeps,
  register: (def: ToolDefinition) => () => void,
): Array<() => void> {
  const { taskEngine, schedulerEngine } = deps

  const createTask = defineTool({
    name: 'openscout_create_task',
    description: '创建一个定时扫描任务（draft 状态）。需提供名称、目标仓库、cron 调度与配额。',
    parameters: {
      name: { type: 'string', required: true },
      repositories: {
        type: 'array', required: true,
        items: { type: 'object', properties: { owner: { type: 'string' }, name: { type: 'string' }, githubId: { type: 'integer' } }, additionalProperties: false },
      },
      schedule: {
        type: 'object', required: true,
        properties: { cron: { type: 'string' }, timezone: { type: 'string' } }, additionalProperties: false,
      },
      quotas: {
        type: 'object', required: true,
        properties: {
          maxIssuesPerRun: { type: 'integer' },
          maxPRsPerRun: { type: 'integer' },
          maxConcurrent: { type: 'integer' },
          maxPRsPerDay: { type: 'integer' },
          maxPRsPerWeek: { type: 'integer' },
        }, additionalProperties: false,
      },
      filters: { type: 'object', additionalProperties: false },
    },
    output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
    timeoutMs: 30_000,
    execute: async (args) => {
      const a = args as any
      const rec = taskEngine.createTask({
        name: a.name,
        repositories: a.repositories,
        schedule: a.schedule,
        quotas: a.quotas,
        filters: a.filters ?? {},
      })
      return rec
    },
  })

  const listTasks = defineTool({
    name: 'openscout_list_tasks',
    description: '列出所有定时任务及其状态。',
    parameters: {},
    output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
    timeoutMs: 30_000,
    execute: async () => taskEngine.listTasks(),
  })

  const activateTask = defineTool({
    name: 'openscout_activate_task',
    description: '激活并排程一个任务（draft/paused → active，开始按 cron 触发扫描）。',
    parameters: { taskId: { type: 'string', required: true } },
    output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
    timeoutMs: 30_000,
    execute: async (args) => {
      const a = args as { taskId: string }
      await schedulerEngine.activate(a.taskId)
      return taskEngine.getTask(a.taskId)
    },
  })

  const pauseTask = defineTool({
    name: 'openscout_pause_task',
    description: '暂停并取消排程一个任务（active → paused）。',
    parameters: { taskId: { type: 'string', required: true } },
    output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
    timeoutMs: 30_000,
    execute: async (args) => {
      const a = args as { taskId: string }
      await schedulerEngine.pause(a.taskId)
      return taskEngine.getTask(a.taskId)
    },
  })

  const deleteTask = defineTool({
    name: 'openscout_delete_task',
    description: '删除一个任务（先取消排程）。',
    parameters: { taskId: { type: 'string', required: true } },
    output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
    timeoutMs: 30_000,
    execute: async (args) => {
      const a = args as { taskId: string }
      schedulerEngine.unschedule(a.taskId)
      const ok = await taskEngine.deleteTask(a.taskId)
      return { deleted: ok }
    },
  })

  return [createTask, listTasks, activateTask, pauseTask, deleteTask].map((def) => register(def))
}
