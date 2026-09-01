// Durable store for the facts failure ledger. Every read-modify-write runs under the same
// identity-scoped `facts-queue` lock the queue uses, so a failure record and the queue file
// it describes can never be observed mid-update by a concurrent launcher.

import { randomUUID } from "node:crypto"
import { mkdir, open, readFile, rename, rm, writeHandleAll } from "../fs/resilient"
import { dirname, join } from "node:path"

import type { MemoryIdentityPaths } from "../identity"
import { createLockRecord, factsQueueLockPath, withLock } from "../locks"
import {
  applyFailure,
  clearForRetry,
  clearOnSuccess,
  type FactsFailureFilter,
  type FactsFailureTarget,
} from "./failures-backoff"
import {
  emptyFailuresFile,
  parseFailuresFile,
  renderFailuresFile,
  type FactsFailureReason,
  type FactsFailureRecord,
  type FactsFailuresFile,
} from "./failures-schema"
import { factsQueuePaths, type FactsQueueLayout } from "./schema"

const LOCK_WAIT_MS = 2000

/** Windows cannot fsync a directory handle; absent files are already durable. */
const SKIPPABLE_SYNC_CODES = new Set(["ENOENT", "EISDIR", "EPERM", "EACCES", "EINVAL"])

export interface FactsFailureStoreOptions {
  readonly identityPaths: MemoryIdentityPaths
  readonly now?: () => Date
  readonly lockWaitMs?: number
}

export interface RecordFailureRequest {
  readonly targets: readonly FactsFailureTarget[]
  readonly failureId: string
  readonly reason: FactsFailureReason
  readonly detail?: string
}

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !("code" in error)) return undefined
  return typeof error.code === "string" ? error.code : undefined
}

async function syncPath(path: string): Promise<void> {
  let handle
  try {
    handle = await open(path, "r")
  } catch (error) {
    if (SKIPPABLE_SYNC_CODES.has(errorCode(error) ?? "")) return
    throw error
  }
  try {
    await handle.sync()
  } catch (error) {
    if (!SKIPPABLE_SYNC_CODES.has(errorCode(error) ?? "")) throw error
  } finally {
    await handle.close()
  }
}

export class FactsFailureStore {
  private readonly layout: FactsQueueLayout
  private readonly lockPath: string
  private readonly lockWaitMs: number
  private readonly now: () => Date

  constructor(options: FactsFailureStoreOptions) {
    this.layout = factsQueuePaths(options.identityPaths)
    this.lockPath = factsQueueLockPath(options.identityPaths.locks)
    this.lockWaitMs = options.lockWaitMs ?? LOCK_WAIT_MS
    this.now = options.now ?? (() => new Date())
  }

  /** FAIL-CLOSED: a corrupt or unsupported file throws instead of reporting no failures. */
  async readFailures(): Promise<FactsFailuresFile> {
    return this.locked(() => this.readUnlocked())
  }

  async recordFailure(request: RecordFailureRequest): Promise<FactsFailuresFile> {
    return this.mutate((entries, at) =>
      applyFailure({
        entries,
        targets: request.targets,
        failureId: request.failureId,
        reason: request.reason,
        ...(request.detail === undefined ? {} : { detail: request.detail }),
        now: at,
      }),
    )
  }

  async clearOnSuccess(targets: readonly FactsFailureTarget[]): Promise<FactsFailuresFile> {
    return this.mutate((entries) => clearOnSuccess(entries, targets))
  }

  /** Manual unpark; returns how many records the retry removed. */
  async clearForRetry(filter: FactsFailureFilter): Promise<number> {
    let removed = 0
    await this.mutate((entries) => {
      const next = clearForRetry(entries, filter)
      removed = entries.length - next.length
      return next
    })
    return removed
  }

  private async mutate(
    change: (entries: readonly FactsFailureRecord[], at: Date) => readonly FactsFailureRecord[],
  ): Promise<FactsFailuresFile> {
    return this.locked(async () => {
      const current = await this.readUnlocked()
      const at = this.now()
      const entries = change(current.entries, at)
      const file: FactsFailuresFile = {
        version: current.version,
        updatedAt: at.toISOString(),
        entries,
      }
      await this.writeAtomically(renderFailuresFile(entries, file.updatedAt))
      return file
    })
  }

  private async readUnlocked(): Promise<FactsFailuresFile> {
    const raw = await readFile(this.layout.failuresPath, "utf8").catch((error: unknown) => {
      if (errorCode(error) === "ENOENT") return undefined
      throw error
    })
    if (raw === undefined) return emptyFailuresFile(this.now().toISOString())
    return parseFailuresFile(raw)
  }

  /** Same-directory temp file, fsync, rename, fsync directory: no torn ledger after a crash. */
  private async writeAtomically(content: string): Promise<void> {
    const directory = dirname(this.layout.failuresPath)
    await mkdir(directory, { recursive: true })
    const temporary = join(directory, `.failures-${process.pid}-${randomUUID()}.tmp`)
    const handle = await open(temporary, "wx", 0o600)
    try {
      await writeHandleAll(handle, content, "utf8")
      await handle.sync()
    } catch (error) {
      await handle.close()
      await rm(temporary, { force: true })
      throw error
    }
    await handle.close()
    try {
      await rename(temporary, this.layout.failuresPath)
    } catch (error) {
      await rm(temporary, { force: true })
      throw error
    }
    await syncPath(directory)
  }

  private async locked<T>(task: () => Promise<T>): Promise<T> {
    await mkdir(this.layout.queueDir, { recursive: true })
    await mkdir(dirname(this.lockPath), { recursive: true })
    const record = await createLockRecord("facts-queue")
    return withLock(this.lockPath, record, task, { waitTimeoutMs: this.lockWaitMs })
  }
}

export {
  applyFailure,
  clearForRetry,
  clearOnSuccess,
  type FactsFailureFilter,
  type FactsFailureTarget,
} from "./failures-backoff"
