/**
 * OpenScout Core — 公共 API
 *
 * 这是核心引擎的入口点。所有外部代码（Adapter 层）只通过此模块使用 Core。
 * Core 层不依赖任何宿主框架（DSH/Codex/OpenCode），只依赖自定义 Port 接口。
 */

// Port 接口
export * from './ports/index.js'

// 数据模型
export * from './models/index.js'

// 引擎（后续逐步添加）
export { SearchEngine } from './engines/search.js'
export type { SearchReposParams, SearchReposResult, SearchIssuesParams, SearchIssuesResult } from './engines/search.js'

export { CandidateRanker, passesRepoHardFilters, defaultRankerConfig, feasibilityOrder } from './engines/ranker.js'
export type { RankedRepository, RankedIssue, RankerConfig, Feasibility } from './engines/ranker.js'

export { assessIssueFeasibility } from './engines/preflight.js'
export type { FeasibilityAssessment } from './engines/preflight.js'

export { DedupEngine, issueDeduplicationKey } from './engines/dedup.js'
export type { DedupDecision, DedupEngineDeps, RegisterInput, RemoteFacts } from './engines/dedup.js'

// M3: 贡献包生成
export { buildReviewBundle } from './engines/contrib/review-bundle-builder.js'
export type { BuildContext } from './engines/contrib/review-bundle-builder.js'
export { transition, isTerminal, canReset } from './engines/contrib/pr-workflow-engine.js'
export type { TransitionRequest, TransitionResult } from './engines/contrib/pr-workflow-engine.js'
export { ContribOrchestrator } from './engines/contrib/orchestrator.js'
export type {
  ContribRequest,
  ContribResult,
  ContribOrchestratorDeps,
  DedupVerdict,
} from './engines/contrib/orchestrator.js'

// M4: 审批与发布
export { requestApproval, isApprovalValid } from './engines/contrib/approval-gate.js'
export type { ApprovalGateRequest, GateResult } from './engines/contrib/approval-gate.js'
export { PublishEngine } from './engines/contrib/publish-engine.js'
export type { PublishRequest, PublishResult, PublishEngineDeps } from './engines/contrib/publish-engine.js'
