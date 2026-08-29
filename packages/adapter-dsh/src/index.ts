/**
 * OpenScout DSH Adapter — Cordis 插件入口。
 *
 * 职责（仅适配器层，不含任何核心业务逻辑）：
 *  1. 声明并打开 OpenScout 持久化域（DSH Domain）；
 *  2. 用 DSH 能力构造 Core 的 Port 实现（Storage / Credential / Approval）；
 *  3. 用 @openscout/github-adapter 的 OctokitGitHubAdapter 作为 GitHubPort；
 *  4. 实例化 Core 引擎并注册 DSH 模型可见工具：
 *     - search_repos / search_issues（M2）
 *     - openscout_approve / openscout_publish（M4 审批与发布）
 *  5. 在插件卸载时按可逆转顺序释放：工具 → 域。
 *
 * 核心引擎（@openscout/core）完全不感知 DSH；换宿主只改本包。
 */

import type { Context, Plugin } from '@deepseek-ai/cordis'
import {
  SearchEngine,
  ContribOrchestrator,
  PublishEngine,
  DedupEngine,
  systemClock,
} from '@openscout/core'
import { OctokitGitHubAdapter } from '@openscout/github-adapter'
import { openscoutDomainSpec } from './spec.js'
import { DshStorage } from './storage.js'
import { DshCredentialPort, GITHUB_TOKEN_REF } from './credential.js'
import { DshApprovalPort } from './approval.js'
import { registerSearchTools } from './tools.js'
import { registerPublishingTools } from './publishing-tools.js'
import { buildScheduler } from './plugin-scheduler.js'
import { registerTaskTools } from './task-tools.js'
import { registerWorkItemTools } from './workitem-tools.js'

/** 插件名称（挂到 cordis.yml 时引用）。 */
export const name = 'openscout-dsh'

/** 声明 Core 需要的 DSH 服务为硬依赖。 */
export const inject = ['storageDomain', 'credentials', 'tools'] as const

/** 部署可变配置（经 cordis.yml 注入）。 */
export interface Config {
  /** GitHub API 基础地址（企业版可覆盖）。 */
  readonly githubBaseUrl?: string
}

export function apply(ctx: Context, _config: Config): void {
  ctx.effect(async () => {
    // 1. 打开持久化域
    const domain = await ctx.storageDomain.open(openscoutDomainSpec)
    const storage = new DshStorage(domain as never)

    // 2. 凭据适配器（每次解析，支持热轮换）
    const credentials = new DshCredentialPort(async (ref) => {
      const resolved = await ctx.credentials.resolve(ref as never)
      return resolved ? { value: resolved.value } : undefined
    }, GITHUB_TOKEN_REF)

    // 3. GitHub 适配器（来自 @openscout/github-adapter；逐操作通过 credentials 解析 Token）
    const github = new OctokitGitHubAdapter(credentials)

    // 4. 审批适配器（可选设施；缺省 fail-closed）
    const approval = new DshApprovalPort(() => ctx.approval as never)

    // 5. 核心引擎 + 工具
    const search = new SearchEngine(github, systemClock)
    const dedup = new DedupEngine({ storage, clock: systemClock })
    // ContribOrchestrator 在 M4 适配器只用于审批控制面（approve）。
    // 其 generate 路径依赖 AgentPort（由 M4 宿主适配 adapter-agent 注入）；
    // 此处提供一个拒绝式 Agent 占位，避免在未接入 Agent 时误触发代码生成。
    const noopAgent = {
      async delegateCodeWork() {
        return { success: false, failureReason: '未接入 Agent 适配器，请经 adapter-agent 驱动生成' }
      },
    }
    const orchestrator = new ContribOrchestrator({ storage, dedup, agent: noopAgent, approval })
    const publishEngine = new PublishEngine({ storage, github, approval })

    const searchDisposers = registerSearchTools(search, (def) => ctx.tools.register(def))
    const publishDisposers = registerPublishingTools(orchestrator, publishEngine, (def) => ctx.tools.register(def))

    // 7. M5 定时任务子系统：TaskEngine + SchedulerEngine（Cordis timer 实现 SchedulerPort）
    const schedulerBundle = buildScheduler({
      ctx, storage, github, agent: noopAgent, approval,
    })
    const taskDisposers = registerTaskTools(
      { taskEngine: schedulerBundle.taskEngine, schedulerEngine: schedulerBundle.schedulerEngine },
      (def) => ctx.tools.register(def),
    )
    const workItemDisposers = registerWorkItemTools(
      { orchestrator },
      (def) => ctx.tools.register(def),
    )
    schedulerBundle.start()

    // 8. 可逆转清理：先卸工具，再停调度，后关域
    return () => {
      for (const dispose of [...searchDisposers, ...publishDisposers, ...taskDisposers, ...workItemDisposers]) dispose()
      schedulerBundle.stop()
      void domain.close()
    }
  })
}

export default { name, inject, apply } satisfies Plugin
