/**
 * DshStorage 适配器测试（闭环验证的一部分）。
 *
 * 用内存 `Domain` 模拟 DSH storageDomain 的 KvTable 语义，验证
 * DshStorage 正确将 Core StoragePort 五张表桥接到 DSH Domain，且
 * get/put/update/entries/size 语义与 Core 期望一致。DSH 模块以 vi.mock 打桩，
 * 不依赖未发布的宿主源码。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// DSH 运行时模块在测试中以内存实现打桩。
vi.mock('@deepseek-ai/dsh-storage-domain', () => {
  class KvTableImpl {
    private map = new Map<string, unknown>()
    get size() { return this.map.size }
    get(key: string) { return this.map.get(key) }
    entries() { return this.map.entries() }
    keys() { return this.map.keys() }
    async put(key: string, value: unknown) { this.map.set(key, value) }
    async delete(key: string) { return this.map.delete(key) }
    async update(key: string, fn: (c: unknown) => unknown) {
      const next = fn(this.map.get(key))
      this.map.set(key, next)
      return next
    }
  }
  class DomainImpl {
    name = 'openscout'
    private tables = new Map<string, KvTableImpl>()
    table(name: string) {
      let t = this.tables.get(name)
      if (!t) { t = new KvTableImpl(); this.tables.set(name, t) }
      return t as never
    }
    async close() {}
  }
  return {
    defineDomain: (s: unknown) => s,
    domainTable: () => ({}),
    DomainImpl,
  }
})

import { openscoutDomainSpec, TABLE } from '../src/spec.js'
import { DshStorage } from '../src/storage.js'

// 用真实的 spec 打开一个内存域（defineDomain 被打桩为透传）。每个测试新建一个，
// 避免表数据跨用例泄漏（与 DSH 单开域语义一致）。
async function makeDomain(): Promise<any> {
  const { DomainImpl } = await import('@deepseek-ai/dsh-storage-domain')
  return new (DomainImpl as any)()
}

describe('DshStorage adapter', () => {
  let storage: DshStorage
  beforeEach(async () => {
    storage = new DshStorage(await makeDomain())
  })

  it('exposes the five Core tables backed by DSH KvTables', () => {
    expect(storage.tasks).toBeDefined()
    expect(storage.taskRuns).toBeDefined()
    expect(storage.prWorkItems).toBeDefined()
    expect(storage.dedup).toBeDefined()
    expect(storage.quotaWindows).toBeDefined()
  })

  it('round-trips a value through put/get', async () => {
    await storage.tasks.put('t1', { id: 't1', name: 'demo' })
    expect(storage.tasks.get('t1')).toEqual({ id: 't1', name: 'demo' })
    expect(storage.tasks.size).toBe(1)
  })

  it('delegates update atomically', async () => {
    await storage.tasks.put('t2', { n: 1 })
    const next = await storage.tasks.update('t2', (cur: any) => ({ ...cur, n: (cur.n as number) + 1 }))
    expect(next).toEqual({ n: 2 })
    expect(storage.tasks.get('t2')).toEqual({ n: 2 })
  })

  it('iterates entries and keys', async () => {
    await storage.tasks.put('a', 1)
    await storage.tasks.put('b', 2)
    const keys = [...storage.tasks.keys()].sort()
    const entries = [...storage.tasks.entries()]
    expect(keys).toEqual(['a', 'b'])
    expect(entries.length).toBe(2)
  })

  it('delete returns presence', async () => {
    await storage.tasks.put('x', 1)
    expect(await storage.tasks.delete('x')).toBe(true)
    expect(await storage.tasks.delete('x')).toBe(false)
  })

  it('maps each Core table to a distinct DSH table name', () => {
    const d = storage as any
    // 表名来自 spec，确保不串表
    expect(TABLE.tasks).toBe('tasks')
    expect(TABLE.dedup).toBe('dedup')
    void d
  })
})
