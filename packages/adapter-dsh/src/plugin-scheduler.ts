/**
 * DSH 定时任务胶水层（M5）。
 *
 * 1. 用 Cordis Fiber 的 `ctx.effect` + `setTimeout` 实现 SchedulerPort（宿主无关，
 *    但由 Cordis 管理生命周期，插件卸载即全部取消）。
 * 2. 用 Core 的 TaskEngine / SchedulerEngine 编排任务的持久化与定时触发。
 *    每次触发调用 `runHandler`：组装 ScanOrchestrator（搜索→去重→生成），
 *    其依赖的 SearchEngine/DedupEngine/ContribOrchestrator 由此处构造。
 *
 * 仅做适配器职责：把 DSH 能力翻译为 Core 的 Port / 引擎调用，无任何核心业务逻辑。
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  TaskEngine,
  SchedulerEngine,
  ScanOrchestrator,
  SearchEngine,
  DedupEngine,
  ContribOrchestrator,
  systemClock,
  type SchedulerPort,
  type CancelFn,
  type GitHubPort,
  type AgentPort,
  type ApprovalPort,
  type StoragePort,
  type ClockPort,
} from '@openscout/core'

export interface SchedulerContextDeps {
  ctx: Context
  storage: StoragePort
  github: GitHubPort
  agent: AgentPort
  approval: ApprovalPort
  clock?: ClockPort
}

/** Cordis timer 实现的 SchedulerPort：回调挂到当前 Fiber，effect 卸载即取消。 */
function cordisScheduler(ctx: Context): SchedulerPort {
  const arm = (delayMs: number, callback: () => Promise<void>): CancelFn => {
    let id: ReturnType<typeof setTimeout> | undefined
    ctx.effect(() => {
      id = setTimeout(() => void callback(), delayMs)
      return () => { if (id) clearTimeout(id) }
    })
    return () => { if (id) clearTimeout(id) }
  }
  return {
    scheduleAt(time: Date, callback: () => Promise<void>): CancelFn {
      return arm(Math.max(0, time.getTime() - Date.now()), callback)
    },
    scheduleAfter(delayMs: number, callback: () => Promise<void>): CancelFn {
      return arm(delayMs, callback)
    },
  }
}

export interface SchedulerBundle {
  taskEngine: TaskEngine
  schedulerEngine: SchedulerEngine
  /** 启动对账：为所有 active 任务注册定时器 */
  start(): void
  /** 停止所有定时器（插件卸载时） */
  stop(): void
}

/** 装配定时任务子系统。返回的 bundle 在宿主 apply 的 effect 内调用。 */
export function buildScheduler(deps: SchedulerContextDeps): SchedulerBundle {
  const clock = deps.clock ?? systemClock
  const schedulerPort = cordisScheduler(deps.ctx)
  const taskEngine = new TaskEngine({ storage: deps.storage, clock })

  // runHandler：组装 ScanOrchestrator 跑一次扫描（依赖真实 GitHub + Agent）
  const runHandler = async (taskId: string) => {
    const searchEngine = new SearchEngine(deps.github, clock)
    const dedup = new DedupEngine({ storage: deps.storage, clock })
    const orchestrator = new ContribOrchestrator({ storage: deps.storage, dedup, agent: deps.agent, approval: deps.approval })
    const scanner = new ScanOrchestrator({
      storage: deps.storage, github: deps.github, clock,
      searchEngine,
      dedupEngine: {
        check: (p) => {
          const d = dedup.checkLocal(p)
          return d.duplicate ? { duplicate: true, reason: d.reason } : { duplicate: false }
        },
      },
      orchestrator, taskEngine,
    })
    await scanner.run(taskId)
  }

  const schedulerEngine = new SchedulerEngine({ taskEngine, scheduler: schedulerPort, clock, runHandler })

  return {
    taskEngine,
    schedulerEngine,
    start() { schedulerEngine.reconcile() },
    stop() { schedulerEngine.stopAll() },
  }
}
