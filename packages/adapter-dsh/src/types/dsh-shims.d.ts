/**
 * DSH 运行时类型垫片（ambient module declarations）。
 *
 * adapter-dsh 在 DSH 宿主内以 Cordis 插件形式挂载，此时 `@deepseek-ai/*`
 * 由宿主运行时解析。为使本包在 OpenScout monorepo 内也能独立 `tsc --build`
 * （无需依赖未发布的 harness 源码），此处声明本包实际用到的 DSH 接口的最小
 * 子集，形状与 harness 源码逐一对应（见调研记录）。
 *
 * ⚠️ 这些是编译期垫片，不是运行时实现；运行时由 DSH 提供真实模块。
 */

declare module '@deepseek-ai/cordis' {
  export interface Context {
    storageDomain: DomainFacility
    credentials: CredentialProvider
    tools: ToolRuntime
    /** 可选：审批设施（缺省时 Core 走 fail-closed）。 */
    approval?: { requestApproval(req: unknown): Promise<unknown> }
    /** Register a disposer-returning effect on the current fiber. */
    effect<T>(dispose: () => T | Promise<T> | void): void
    /** Subscribe to an event. */
    on<K extends string>(event: K, listener: (...args: unknown[]) => void): () => void
  }
  export interface Plugin {
    name?: string
    inject?: readonly string[]
    apply(ctx: Context, config?: unknown): void
  }
  export type { Context as CordisContext }
}

declare module '@deepseek-ai/dsh-storage-domain' {
  export interface KvTable<K extends string, V> {
    get(key: K): V | undefined
    entries(): IterableIterator<[K, V]>
    keys(): IterableIterator<K>
    readonly size: number
    put(key: K, value: V): Promise<void>
    delete(key: K): Promise<boolean>
    update(key: K, fn: (current: V) => V): Promise<V>
  }
  export interface Domain<S> {
    readonly name: string
    table(name: string): KvTable<string, unknown>
    close(): Promise<void>
  }
  export interface DomainTableSpec<K extends string = string, V = unknown> {
    readonly valueSchema: { parse: (v: unknown) => V; safeParse: (v: unknown) => { success: boolean; data?: V; error?: unknown } }
  }
  export interface DomainSpec {
    readonly name: string
    readonly version: number
    readonly tables: Record<string, DomainTableSpec>
  }
  export function defineDomain<S extends DomainSpec>(spec: S): S
  export function domainTable<K extends string, V>(schema: { parse: (v: unknown) => V }): DomainTableSpec<K, V>
  export interface DomainFacility {
    open<S extends DomainSpec>(spec: S): Promise<Domain<S>>
  }
}

declare module '@deepseek-ai/dsh-credentials' {
  export type CredentialRef = string & { __brand: 'CredentialRef' }
  export function credentialRef(value: string): CredentialRef
  export interface ResolvedCredential {
    value: string
    source: string
  }
  export interface CredentialProvider {
    resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined>
  }
}

declare module '@deepseek-ai/dsh-tools' {
  export interface ParameterSchemaSpec {
    [key: string]: ValueSchemaSpec & { required?: true }
  }
  export type ValueSchemaSpec =
    | { type: 'string'; enum?: readonly string[] }
    | { type: 'integer' }
    | { type: 'number' }
    | { type: 'boolean' }
    | { type: 'array'; items?: ValueSchemaSpec }
    | { type: 'object'; properties?: ParameterSchemaSpec; additionalProperties: boolean }
    | { type: 'json' }

  export interface ContentBlock {
    type: string
    text?: string
    [key: string]: unknown
  }

  export interface ToolRunContext {
    signal: AbortSignal
  }

  export interface ToolDefinition {
    name: string
    description: string
    parameters: Record<string, unknown>
    output: { schema: ValueSchemaSpec; render: (args: unknown, value: unknown) => ContentBlock[] }
    timeoutMs?: number
    execute(args: unknown, exec: ToolRunContext): Promise<unknown>
  }

  export interface ToolRuntime {
    register(definition: ToolDefinition): () => void
  }

  export function defineTool<S extends ParameterSchemaSpec, O extends ValueSchemaSpec>(
    options: {
      name: string
      description: string
      parameters: S
      output: { schema: O; render: (args: unknown, value: unknown) => ContentBlock[] }
      timeoutMs?: number
      execute: (args: unknown, exec: ToolRunContext) => Promise<unknown>
    },
  ): ToolDefinition
}
