/**
 * Port 接口汇总导出
 *
 * 所有 Port 接口定义了 OpenScout Core 与外部世界的契约边界。
 * Core 层代码只依赖这些接口，不依赖任何具体实现或框架。
 */

export type { TablePort, StoragePort, StorageChangeHandler } from './storage.js'
export type {
  GitHubPort,
  RepoSearchQuery,
  RepoSearchResult,
  IssueSearchQuery,
  IssueSearchResult,
  RepositoryInfo,
  LicenseInfo,
  IssueInfo,
  IssueDetail,
  PRReference,
  TimelineEvent,
  ForkResult,
  Commit,
  CreatePRParams,
  PRResult,
  ForkInfo,
} from './github.js'
export type {
  AgentPort,
  CodeWorkRequest,
  CodeWorkResult,
  ValidationResult,
} from './agent.js'
export type {
  ApprovalPort,
  ApprovalRequest,
  ApprovalOutcome,
} from './approval.js'
export type { SchedulerPort, CancelFn } from './scheduler.js'
export type { FileSystemPort } from './filesystem.js'
export type { ShellPort, ShellOptions, ShellResult } from './shell.js'
export type { CredentialPort } from './credential.js'
export type { NotifyPort, Notification, NotificationLevel } from './notify.js'
export type { ClockPort } from './clock.js'
export { systemClock } from './clock.js'
