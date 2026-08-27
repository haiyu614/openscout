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
