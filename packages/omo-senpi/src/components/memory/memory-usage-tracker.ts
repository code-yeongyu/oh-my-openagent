import { relative, resolve, sep } from "node:path"

import type { ComponentLogger } from "../../extension/types"
import {
  createMemoryUsageLockRecord,
  incrementMemoryUsageBatch,
  type MemoryUsageLedgerPath,
} from "./memory-usage-ledger"

const DEBOUNCE_MS = 500

/**
 * Extracts the repo-relative path from a file read, returning undefined when
 * the path does not resolve inside the memory repo or is under system/, .git, or .tmp.
 */
export function extractMemoryUsagePath(repoDir: string, rawPath: string): string | undefined {
  if (rawPath.length === 0 || rawPath.includes("\0")) return undefined
  const absolute = resolve(rawPath)
  const rel = relative(repoDir, absolute)
  if (rel.startsWith("..")) return undefined
  const segments = rel.split(sep)
  // Exclude system/ (always projected), .git, .tmp
  if (segments[0] === "system" || segments[0] === ".git" || segments[0] === ".tmp") return undefined
  if (segments[0] === ".") return undefined
  return segments.join("/")
}

/** Debounces memory-file reads and persists each pending batch under the ledger lock. */
export class MemoryUsageTracker {
  private readonly paths: MemoryUsageLedgerPath
  private readonly repoDir: string
  private readonly now: () => Date
  private readonly logger?: ComponentLogger
  private pending = new Map<string, number>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private flushPromise: Promise<void> | undefined

  constructor(options: {
    readonly paths: MemoryUsageLedgerPath
    readonly repoDir: string
    readonly now?: () => Date
    readonly logger?: ComponentLogger
  }) {
    this.paths = options.paths
    this.repoDir = options.repoDir
    this.now = options.now ?? (() => new Date())
    this.logger = options.logger
  }

  /** Records a memory-file read. Paths outside the repo or under excluded dirs are ignored. */
  recordRead(rawPath: string): void {
    const relativePath = extractMemoryUsagePath(this.repoDir, rawPath)
    if (relativePath === undefined) return
    this.pending.set(relativePath, (this.pending.get(relativePath) ?? 0) + 1)
    this.scheduleFlush()
  }

  /** Flushes pending increments immediately. Never throws. */
  async flush(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted === true) return
    if (this.flushPromise !== undefined) return this.flushPromise
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    if (this.pending.size === 0) return
    const batch = new Map(this.pending)
    this.pending.clear()
    this.flushPromise = this.flushBatch(batch, signal).finally(() => {
      this.flushPromise = undefined
    })
    return this.flushPromise
  }

  private scheduleFlush(): void {
    if (this.timer !== undefined) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.flush()
    }, DEBOUNCE_MS)
  }

  private async flushBatch(batch: ReadonlyMap<string, number>, signal?: AbortSignal): Promise<void> {
    const record = await createMemoryUsageLockRecord()
    await incrementMemoryUsageBatch(this.paths, batch, this.now, record, signal)
  }
}
