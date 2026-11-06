import { createHash } from "node:crypto"
import type { GitMemoryRepo } from "../git"
import type { CompiledBlockStore } from "./block-persist"
import { compileMemoryBlockWithReads, type CompileMemoryBlockOptions, type MemoryExpiry } from "./compile"
import { expirySlot } from "./expiry-slot"
import { DEFAULT_EXTERNAL_PROJECTION_LIMITS } from "./external-projection-limits"
import { InFlightReads } from "./in-flight-reads"

export const MEMORY_TEMPLATE_STRUCTURE_VERSION = "senpi-memory-v2"

/**
 * Bump with ANY change to the bytes `compileMemoryBlockAtRevision` produces for the same inputs: persisted blocks
 * are keyed by it and by the caller's `build`, and a block compiled by older code must never be served.
 */
export const MEMORY_BLOCK_COMPILER_VERSION = 2

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
  /** The clock `expires` is evaluated against when a compile names no instant. */
  readonly now?: () => number
}

const DEFAULT_STORE_BUDGET_MS = 25

/** A compiled block and every `expires` instant its revision declares, passed or not. */
export interface CompiledMemoryBlock {
  readonly block: string
  readonly expiries: readonly MemoryExpiry[]
}

/**
 * One key's blocks at one revision, one per expiry slot. `first` is the compile that will tell which instants the
 * revision declares; a concurrent caller shares it instead of compiling the same revision twice.
 */
interface MemoryBlockCacheEntry {
  readonly variant: string
  expiries?: readonly MemoryExpiry[]
  first?: Promise<CompiledMemoryBlock>
  readonly blocks: Map<string, Promise<CompiledMemoryBlock>>
}

export class MemoryBlockCache {
  private readonly entries = new Map<string, MemoryBlockCacheEntry>()
  private readonly options: MemoryBlockCacheOptions
  private module: Promise<CompiledBlockStoreModule | undefined> | undefined
  private readonly stores = new Map<string, CompiledBlockStore>()
  private readonly reads = new InFlightReads()

  constructor(options: MemoryBlockCacheOptions = {}) {
    this.options = options
  }

  get size(): number {
    return this.entries.size
  }

  /**
   * Compile at `revision`, or at HEAD when it is omitted. A caller that pins a session to one commit
   * passes that commit so later memory commits cannot change the bytes it injects, and passes the pin instant as
   * `asOfMs` so a file expiring later does not change them either.
   */
  compile(
    repo: GitMemoryRepo,
    template: string,
    options: CompileMemoryBlockOptions,
    pinnedRevision?: string | null,
    asOfMs?: number,
  ): Promise<string> {
    return this.compileWithExpiries(repo, template, options, pinnedRevision, asOfMs).then((compiled) => compiled.block)
  }

  /** `compile`, plus the revision's `expires` instants, so a pinned caller can announce what expired after its pin. */
  compileWithExpiries(
    repo: GitMemoryRepo,
    template: string,
    options: CompileMemoryBlockOptions,
    pinnedRevision?: string | null,
    asOfMs?: number,
  ): Promise<CompiledMemoryBlock> {
    return this.track(() => this.compileWithExpiriesAt(repo, template, options, pinnedRevision, asOfMs))
  }

  private async compileWithExpiriesAt(
    repo: GitMemoryRepo,
    template: string,
    options: CompileMemoryBlockOptions,
    pinnedRevision: string | null | undefined,
    asOfMs: number | undefined,
  ): Promise<CompiledMemoryBlock> {
    const revision = pinnedRevision === undefined ? await repo.head() : pinnedRevision
    const at = asOfMs ?? (this.options.now ?? Date.now)()
    const limits = options.projection ?? DEFAULT_EXTERNAL_PROJECTION_LIMITS
    const key = `${hashMemoryTemplate(template)}:${options.agentId}:${limits.maxEntriesPerDirectory}:${limits.maxBytes}`
    const entry = this.entryFor(key, revision ?? "no-head")
    if (entry.expiries === undefined && entry.first !== undefined) await entry.first.catch(() => undefined)
    const slot = entry.expiries === undefined ? undefined : expirySlot(entry.expiries, at)
    const existing = slot === undefined ? undefined : entry.blocks.get(slot)
    if (existing !== undefined) return existing

    const pending = revision === null
      ? compileMemoryBlockWithReads(repo, null, options, at)
      : this.compileStored(repo, `block:${key}:${JSON.stringify(options)}`, revision, options, at)
    if (slot === undefined) entry.first = pending
    else entry.blocks.set(slot, pending)
    try {
      const compiled = await pending
      entry.expiries ??= compiled.expiries
      entry.blocks.set(expirySlot(compiled.expiries, at), pending)
      return compiled
    } catch (error) {
      if (entry.first === pending) entry.first = undefined
      if (slot !== undefined && entry.blocks.get(slot) === pending) entry.blocks.delete(slot)
      throw error
    }
  }

  private entryFor(key: string, variant: string): MemoryBlockCacheEntry {
    const existing = this.entries.get(key)
    if (existing?.variant === variant) return existing
    const entry: MemoryBlockCacheEntry = { variant, blocks: new Map() }
    this.entries.set(key, entry)
    return entry
  }

  /**
   * The block of `revision` at `asOfMs`, from the persisted store when an earlier process stored the block of the same
   * expiry slot, compiled (and stored, unless degraded) otherwise. One entry per block: a compile in another slot
   * replaces it, which happens once per passed instant.
   */
  private async compileStored(
    repo: GitMemoryRepo,
    name: string,
    revision: string,
    options: CompileMemoryBlockOptions,
    asOfMs: number,
  ): Promise<CompiledMemoryBlock> {
    const store = this.options.store === undefined ? undefined : await this.storeWithin(repo.dir)
    const key = this.persistKey(revision, name)
    const stored = store === undefined ? undefined : await store.getBlock(key)
    if (stored !== undefined && stored.slot === expirySlot(stored.expiries, asOfMs)) {
      return { block: stored.block, expiries: stored.expiries }
    }
    const { block, degraded, expiries } = await compileMemoryBlockWithReads(repo, revision, options, asOfMs)
    if (degraded.length > 0) this.options.onDegraded?.({ dir: repo.dir, revision, reasons: degraded })
    else store?.putBlock(key, { block, expiries, slot: expirySlot(expiries, asOfMs) })
    return { block, expiries }
  }

  private persistKey(revision: string, name: string): string {
    return JSON.stringify([MEMORY_BLOCK_COMPILER_VERSION, this.options.build ?? "", revision, name])
  }

  /**
   * A value derived from `revision` alone (for `name`), read from the persisted store when an earlier process
   * stored it and computed otherwise. A computed value is stored in the background only when `compute` says it is
   * the value of that commit (`persist`), never a fallback produced by a failed read. Without a store this is
   * `compute()`.
   */
  remember(
    repo: GitMemoryRepo,
    name: string,
    revision: string,
    compute: () => Promise<{ readonly value: string; readonly persist: boolean }>,
  ): Promise<string> {
    return this.track(() => this.rememberAt(repo, name, revision, compute))
  }

  private async rememberAt(
    repo: GitMemoryRepo,
    name: string,
    revision: string,
    compute: () => Promise<{ readonly value: string; readonly persist: boolean }>,
  ): Promise<string> {
    if (this.options.store === undefined) return (await compute()).value
    const key = this.persistKey(revision, name)
    const store = await this.storeWithin(repo.dir)
    const stored = store === undefined ? undefined : await store.get(key)
    if (stored !== undefined) return stored
    const { value, persist } = await compute()
    if (persist) store?.put(key, value)
    return value
  }

  /**
   * Runs `work` as this cache's own: settled() waits for it. A caller that reads the repository before handing the
   * result to compile() (a prebuild reading HEAD) runs that read through here, so no git read it starts outlives
   * settled().
   */
  track<T>(work: () => Promise<T>): Promise<T> {
    return this.reads.track(work)
  }

  /**
   * Settles once nothing this cache started is running: no compile or remember() call from its first git read on
   * (HEAD, the store load, the block compile), no track()ed work, and no store write. A session shutdown waits on
   * this before the identity directory may be removed (#11135).
   */
  async settled(): Promise<void> {
    await this.reads.settled()
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
