/**
 * OpenScout DSH 持久化域声明。
 *
 * 将 Core 的 `StoragePort` 五张业务表映射为 DSH Domain 的 KvTable：
 *  - tasks        → taskRecord
 *  - taskRuns     → taskRunRecord
 *  - prWorkItems  → prWorkItemRecord
 *  - dedup        → dedupRecord
 *  - quotaWindows → quotaWindowRecord
 *
 * 校验 schema 直接复用 @openscout/core 的 zod schema（同一份真相），
 * 在持久化边界做校验（与 harness storage-domain 的契约一致）。
 */

import {
  TaskRecord,
  TaskRunRecord,
  PRWorkItemRecord,
  DedupRecord,
  QuotaWindowRecord,
} from '@openscout/core'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

export const OPENSCOUT_DOMAIN_NAME = 'openscout'
export const OPENSCOUT_DOMAIN_VERSION = 1

/** 各表名（必须匹配 UNIT_NAME_RE：小写字母数字与连字符/下划线） */
export const TABLE = {
  tasks: 'tasks',
  taskRuns: 'task_runs',
  prWorkItems: 'pr_work_items',
  dedup: 'dedup',
  quotaWindows: 'quota_windows',
} as const

/**
 * 域声明。DSH 在打开时按 schema 校验每条记录；表名/版本非法会在模块加载时
 * 抛错（fail loud before any medium is touched）。
 */
export const openscoutDomainSpec = defineDomain({
  name: OPENSCOUT_DOMAIN_NAME,
  version: OPENSCOUT_DOMAIN_VERSION,
  tables: {
    [TABLE.tasks]: domainTable(TaskRecord),
    [TABLE.taskRuns]: domainTable(TaskRunRecord),
    [TABLE.prWorkItems]: domainTable(PRWorkItemRecord),
    [TABLE.dedup]: domainTable(DedupRecord),
    [TABLE.quotaWindows]: domainTable(QuotaWindowRecord),
  },
})
