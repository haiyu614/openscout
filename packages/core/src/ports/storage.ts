/**
 * StoragePort — 持久化接口
 *
 * 核心引擎通过此接口读写数据，不关心底层是 SQLite、DSH Domain KV、文件还是内存。
 * 所有读操作同步（内存态），写操作异步（等待持久化）。
 */

/** 泛型表接口：核心引擎操作数据的唯一入口 */
export interface TablePort<K extends string, V> {
  /** 同步读取一条记录 */
  get(key: K): V | undefined
  /** 持久写入（插入或覆盖） */
  put(key: K, value: V): Promise<void>
  /** 删除一条记录，返回是否存在并删除 */
  delete(key: K): Promise<boolean>
  /** 原子读-改-写：fn 在写链上执行，保证不被并发插入 */
  update(key: K, fn: (current: V) => V): Promise<V>
  /** 遍历所有记录 */
  entries(): IterableIterator<[K, V]>
  /** 遍历所有 key */
  keys(): IterableIterator<K>
  /** 当前记录数量 */
  readonly size: number
}

/** 存储变更事件回调 */
export type StorageChangeHandler = (
  table: string,
  key: string,
  operation: 'put' | 'deleted',
) => void

/** 完整存储接口：包含所有业务表 */
export interface StoragePort {
  /** 任务表 */
  tasks: TablePort<string, unknown>
  /** 任务运行表 */
  taskRuns: TablePort<string, unknown>
  /** PR 工作项表 */
  prWorkItems: TablePort<string, unknown>
  /** 去重注册表 */
  dedup: TablePort<string, unknown>
  /** 配额窗口表 */
  quotaWindows: TablePort<string, unknown>

  /** 注册变更监听器，返回取消函数 */
  onChange(handler: StorageChangeHandler): () => void
}
