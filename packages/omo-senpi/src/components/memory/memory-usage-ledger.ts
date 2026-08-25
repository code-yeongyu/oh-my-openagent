import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { join } from "node:path"

import {
  createLockRecord,
  memoryUsageLockPath,
  withLock,
  type LockRecord,
  type MemoryIdentityPaths,
} from "@oh-my-opencode/memory-core"

import type { ComponentLogger } from "../../extension/types"

/** Memory-usage ledger entry: per file path, a read count and last-used timestamp. */
export interface MemoryUsageEntry {
  readonly count: number
  readonly lastUsedAt: string
}

export type MemoryUsageLedger = Readonly<Record<string, MemoryUsageEntry>>

export interface MemoryUsageLedgerPath {
  readonly ledgerPath: string
  readonly lockPath: string
}

const LOCK_WAIT_MS = 2000

export function memoryUsagePaths(identityPaths: MemoryIdentityPaths): MemoryUsageLedgerPath {
  return {
    ledgerPath: join(identityPaths.runtime, "memory-usage.json"),
    lockPath: memoryUsageLockPath(identityPaths.locks),
  }
}

/** Reads the ledger, returning an empty object when the file is absent or unreadable. */
export async function readMemoryUsageLedger(ledgerPath: string): Promise<MemoryUsageLedger> {
  try {
    return parseLedger(await readFile(ledgerPath, "utf8"))
  } catch {
    return {}
  }
}

/** Increments one file path under the identity-scoped lock. Never throws. */
export async function incrementMemoryUsage(
  paths: MemoryUsageLedgerPath,
  relativePath: string,
  now: () => Date,
  logger?: ComponentLogger,
): Promise<void> {
  const record = await createMemoryUsageLockRecord()
  try {
    await incrementMemoryUsageBatch(paths, new Map([[relativePath, 1]]), now, record)
  } catch (error) {
    logger?.warn("memory-usage ledger write failed", { relativePath, error: String(error) })
  }
}

export function createMemoryUsageLockRecord(): Promise<LockRecord> {
  return createLockRecord("memory-usage")
}

/** Merges a batch under the identity-scoped lock so concurrent sessions lose no increments. */
export async function incrementMemoryUsageBatch(
  paths: MemoryUsageLedgerPath,
  increments: ReadonlyMap<string, number>,
  now: () => Date,
  record: LockRecord,
  signal?: AbortSignal,
): Promise<void> {
  const isAborted = (): boolean => signal?.aborted === true
  await withLock(
    paths.lockPath,
    record,
    async () => {
      const current = await readMemoryUsageLedger(paths.ledgerPath)
      const timestamp = now().toISOString()
      const updated: Record<string, MemoryUsageEntry> = { ...current }
      for (const [relativePath, increment] of increments) {
        const entry = updated[relativePath]
        updated[relativePath] = {
          count: (entry?.count ?? 0) + increment,
          lastUsedAt: timestamp,
        }
      }
      if (isAborted()) return
      await mkdir(join(paths.ledgerPath, ".."), { recursive: true })
      if (isAborted()) return
      await writeLedgerAtomic(paths.ledgerPath, updated)
    },
    { waitTimeoutMs: LOCK_WAIT_MS },
  )
}

async function writeLedgerAtomic(ledgerPath: string, ledger: MemoryUsageLedger): Promise<void> {
  const tmp = `${ledgerPath}.tmp`
  await writeFile(tmp, `${JSON.stringify(ledger, null, 2)}\n`, "utf8")
  await rename(tmp, ledgerPath)
}

function parseLedger(text: string): MemoryUsageLedger {
  const parsed = JSON.parse(text)
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {}
  return parsed as MemoryUsageLedger
}
