/**
 * InMemoryStorage — 内存存储实现（用于测试和 CLI）
 *
 * 实现 StoragePort 接口，数据保存在内存中，进程退出即丢失。
 */

import type { TablePort, StoragePort, StorageChangeHandler } from '@openscout/core'

class InMemoryTable<K extends string, V> implements TablePort<K, V> {
  private readonly data = new Map<string, V>()
  private readonly onWrite: (key: string, op: 'put' | 'deleted') => void

  constructor(onWrite: (key: string, op: 'put' | 'deleted') => void) {
    this.onWrite = onWrite
  }

  get(key: K): V | undefined {
    return this.data.get(key)
  }

  async put(key: K, value: V): Promise<void> {
    this.data.set(key, value)
    this.onWrite(key, 'put')
  }

  async delete(key: K): Promise<boolean> {
    const existed = this.data.has(key)
    if (existed) {
      this.data.delete(key)
      this.onWrite(key, 'deleted')
    }
    return existed
  }

  async update(key: K, fn: (current: V) => V): Promise<V> {
    const current = this.data.get(key)
    if (current === undefined) {
      throw new Error(`Key not found: ${key}`)
    }
    const next = fn(current)
    this.data.set(key, next)
    this.onWrite(key, 'put')
    return next
  }

  entries(): IterableIterator<[K, V]> {
    return this.data.entries() as IterableIterator<[K, V]>
  }

  keys(): IterableIterator<K> {
    return this.data.keys() as IterableIterator<K>
  }

  get size(): number {
    return this.data.size
  }
}

export class InMemoryStorage implements StoragePort {
  private readonly handlers = new Set<StorageChangeHandler>()

  readonly tasks: TablePort<string, unknown>
  readonly taskRuns: TablePort<string, unknown>
  readonly prWorkItems: TablePort<string, unknown>
  readonly dedup: TablePort<string, unknown>
  readonly quotaWindows: TablePort<string, unknown>

  constructor() {
    const notify = (table: string) => (key: string, op: 'put' | 'deleted') => {
      for (const handler of this.handlers) {
        handler(table, key, op)
      }
    }

    this.tasks = new InMemoryTable(notify('tasks'))
    this.taskRuns = new InMemoryTable(notify('taskRuns'))
    this.prWorkItems = new InMemoryTable(notify('prWorkItems'))
    this.dedup = new InMemoryTable(notify('dedup'))
    this.quotaWindows = new InMemoryTable(notify('quotaWindows'))
  }

  onChange(handler: StorageChangeHandler): () => void {
    this.handlers.add(handler)
    return () => { this.handlers.delete(handler) }
  }
}
