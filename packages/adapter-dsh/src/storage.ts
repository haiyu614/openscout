/**
 * DSH Domain → Core StoragePort 适配器。
 *
 * 将 DSH 的 `Domain`（每表一个 `KvTable`）映射为 Core 定义的 `StoragePort`。
 * 读写语义完全一致：get 同步、put/delete/update 异步、update 原子。
 * 这是「核心零框架依赖 + 宿主适配层」原则的落地：Core 不知 DSH，DSH 在此桥接。
 */

import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { TABLE } from './spec.js'
import type {
  StoragePort,
  TablePort,
  StorageChangeHandler,
} from '@openscout/core'

/** 一个 DSH KvTable 的 Core 视图（包一层类型安全转换）。 */
class DshTable<K extends string, V> implements TablePort<K, V> {
  constructor(
    private readonly table: ReturnType<Domain<never>['table']>,
  ) {}

  get(key: K): V | undefined {
    return this.table.get(key) as V | undefined
  }

  async put(key: K, value: V): Promise<void> {
    await this.table.put(key, value as unknown)
  }

  async delete(key: K): Promise<boolean> {
    return this.table.delete(key)
  }

  async update(key: K, fn: (current: V) => V): Promise<V> {
    return this.table.update(key, fn as (c: unknown) => unknown) as Promise<V>
  }

  entries(): IterableIterator<[K, V]> {
    return this.table.entries() as IterableIterator<[K, V]>
  }

  keys(): IterableIterator<K> {
    return this.table.keys() as IterableIterator<K>
  }

  get size(): number {
    return this.table.size
  }
}

export class DshStorage implements StoragePort {
  readonly tasks: TablePort<string, unknown>
  readonly taskRuns: TablePort<string, unknown>
  readonly prWorkItems: TablePort<string, unknown>
  readonly dedup: TablePort<string, unknown>
  readonly quotaWindows: TablePort<string, unknown>

  private readonly handlers = new Set<StorageChangeHandler>()

  constructor(domain: Domain<never>) {
    this.tasks = new DshTable(domain.table(TABLE.tasks))
    this.taskRuns = new DshTable(domain.table(TABLE.taskRuns))
    this.prWorkItems = new DshTable(domain.table(TABLE.prWorkItems))
    this.dedup = new DshTable(domain.table(TABLE.dedup))
    this.quotaWindows = new DshTable(domain.table(TABLE.quotaWindows))
  }

  onChange(handler: StorageChangeHandler): () => void {
    this.handlers.add(handler)
    return () => { this.handlers.delete(handler) }
  }

  /** 供插件在记录变更后通知 Core 监听器（DSH 不自动转发变更到 Core 的 onChange）。 */
  emitChange(table: string, key: string, operation: 'put' | 'deleted'): void {
    for (const h of this.handlers) h(table, key, operation)
  }
}
