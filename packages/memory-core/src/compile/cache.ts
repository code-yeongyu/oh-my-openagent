import { createHash } from "node:crypto"
import type { GitMemoryRepo } from "../git"
import type { CompiledBlockStore } from "./block-persist"
import {
  compileMemoryBlockAtRevision,
  compileMemoryBlockWithReads,
  type CompileMemoryBlockOptions,
} from "./compile"
import { DEFAULT_EXTERNAL_PROJECTION_LIMITS } from "./external-projection"

export const MEMORY_TEMPLATE_STRUCTURE_VERSION = "senpi-memory-v2"

/**
 * Bump with ANY change to the bytes `compileMemoryBlockAtRevision` produces for the same inputs: persisted blocks
 * are keyed by it and by the caller's `build`, and a block compiled by older code must never be served.
 */
export const MEMORY_BLOCK_COMPILER_VERSION = 1

export function hashMemoryTemplate(template: string): string {
  return createHash("sha256")
    .update(MEMORY_TEMPLATE_STRUCTURE_VERSION)
    .update("\0")
    .update(template)
    .digest("hex")
}

export interface CompiledBlockStoreModule {
  readonly CompiledBlockStore: typeof CompiledBlockStore
}

export interface MemoryBlockCacheOptions {
  /**
   * Loads the persisted-block store. Without it the cache keeps blocks in memory only, as before. It is a loader so
   * the store can ship in a lazily imported bundle; a failed load is reported and retried on the next compile.
   */
  readonly store?: () => Promise<CompiledBlockStoreModule>
  readonly onStoreError?: (error: unknown) => void
  /**
   * Called when a compile fell back after a failed git read. That block serves this turn only: it is never stored,
   * and the next process compiles the commit again.
   */
  readonly onDegraded?: (degraded: { readonly dir: string; readonly revision: string; readonly reasons: readonly string[] }) => void
  /** Identifies the build serving blocks; part of every persisted key, so an upgrade never reads an older build's. */
  readonly build?: string
  /**
   * How long a compile waits for the store before compiling as if it had none. The store is normally loaded by then
   * (a prebuild at session bind starts it), so this only bounds a slow first load.
   */
  readonly storeBudgetMs?: number
}

const DEFAULT_STORE_BUDGET_MS = 25

interface MemoryBlockCacheEntry {
  readonly variant: string
  readonly pending: Promise<string>
}

export class MemoryBlockCache {
  private readonly entries = new Map<string, MemoryBlockCacheEntry>()
  private readonly options: MemoryBlockCacheOptions
  private module: Promise<CompiledBlockStoreModule | undefined> | undefined
  private readonly stores = new Map<string, CompiledBlockStore>()
  private readonly computing = new Set<Promise<unknown>>()

  constructor(options: MemoryBlockCacheOptions = {}) {
    this.options = options
  }

  get size(): number {
    return this.entries.size
  }

  /**
   * Compile at `revision`, or at HEAD when it is omitted. A caller that pins a session to one commit
   * passes that commit so later memory commits cannot change the bytes it injects.
   */
  async compile(
    repo: GitMemoryRepo,
    template: string,
    options: CompileMemoryBlockOptions,
    pinnedRevision?: string | null,
  ): Promise<string> {
    const revision = pinnedRevision === undefined ? await repo.head() : pinnedRevision
    const limits = options.projection ?? DEFAULT_EXTERNAL_PROJECTION_LIMITS
    const key = `${hashMemoryTemplate(template)}:${options.agentId}:${limits.maxEntriesPerDirectory}:${limits.maxBytes}`
    const variant = revision ?? "no-head"
    const existing = this.entries.get(key)
    if (existing?.variant === variant) return existing.pending

    const pending = revision === null
      ? compileMemoryBlockAtRevision(repo, revision, options)
      : this.remember(repo, `block:${key}:${JSON.stringify(options)}`, revision, async () => {
        const { block, degraded } = await compileMemoryBlockWithReads(repo, revision, options)
        if (degraded.length > 0) this.options.onDegraded?.({ dir: repo.dir, revision, reasons: degraded })
        return { value: block, persist: degraded.length === 0 }
      })
    const entry = { variant, pending }
    this.entries.set(key, entry)
    try {
      return await pending
    } catch (error) {
      if (this.entries.get(key) === entry) this.entries.delete(key)
      throw error
    }
  }

  /**
   * A value derived from `revision` alone (for `name`), read from the persisted store when an earlier process
   * stored it and computed otherwise. A computed value is stored in the background only when `compute` says it is
   * the value of that commit (`persist`), never a fallback produced by a failed read. Without a store this is
   * `compute()`.
   */
  async remember(
    repo: GitMemoryRepo,
    name: string,
    revision: string,
    compute: () => Promise<{ readonly value: string; readonly persist: boolean }>,
  ): Promise<string> {
    if (this.options.store === undefined) return (await compute()).value
    const key = JSON.stringify([MEMORY_BLOCK_COMPILER_VERSION, this.options.build ?? "", revision, name])
    const store = await this.storeWithin(repo.dir)
    const stored = store === undefined ? undefined : await store.get(key)
    if (stored !== undefined) return stored
    const computed = compute()
    this.computing.add(computed)
    try {
      const { value, persist } = await computed
      if (persist) store?.put(key, value)
      return value
    } finally {
      this.computing.delete(computed)
    }
  }

  /** Settles once no compile that may store a value, and no store write this cache started, is running. */
  async settled(): Promise<void> {
    while (this.computing.size > 0) await Promise.allSettled([...this.computing])
    await Promise.all([...this.stores.values()].map((store) => store.settled()))
  }

  clear(): void {
    this.entries.clear()
  }

  /** The repository's store when it loads within the budget; a compile never waits longer on it. */
  private async storeWithin(dir: string): Promise<CompiledBlockStore | undefined> {
    const existing = this.stores.get(dir)
    if (existing !== undefined) return existing
    let expire: () => void = () => undefined
    const budget = new Promise<undefined>((resolve) => {
      expire = () => resolve(undefined)
    })
    const timer = setTimeout(expire, this.options.storeBudgetMs ?? DEFAULT_STORE_BUDGET_MS)
    try {
      const module = await Promise.race([this.loadModule(), budget])
      if (module === undefined) return undefined
      let store = this.stores.get(dir)
      if (store === undefined) {
        store = new module.CompiledBlockStore(dir, this.options.onStoreError ?? (() => undefined))
        this.stores.set(dir, store)
      }
      return store
    } finally {
      clearTimeout(timer)
    }
  }

  private loadModule(): Promise<CompiledBlockStoreModule | undefined> {
    const loader = this.options.store
    if (loader === undefined) return Promise.resolve(undefined)
    this.module ??= loader().catch((error: unknown) => {
      this.module = undefined
      this.options.onStoreError?.(error)
      return undefined
    })
    return this.module
  }
}
