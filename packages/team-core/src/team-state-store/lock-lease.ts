import { randomUUID } from "node:crypto"
import { open, readdir, readFile, rename, rm } from "node:fs/promises"
import { basename, dirname, join } from "node:path"

import { withRecordGuard } from "./lock-reclaim"

/** The lock record changed while it was handed to another process: the critical section must stop writing. */
export class LockLeaseLostError extends Error {
  constructor(lockPath: string) {
    super(`The lock at ${lockPath} changed while it was handed over; the critical section was aborted.`)
    this.name = "LockLeaseLostError"
  }
}

/**
 * Hands a held lock to a child process for the duration of one call and takes it back (#11262 design 3.6, R2).
 *
 * `handOver(pid)` atomically replaces this process's record with one naming `pid` and a fresh instance id, so every
 * version of the lock treats the child as the live holder: no other process can acquire the lock while the child lives,
 * even if this process dies. When the child exits without a `restore`, its 4-line record is stale at once.
 *
 * `restore()` is compare-and-restore under the reclaim guard of the handed-over record, the same guard every reaper of
 * that record takes: no reaper can remove the record between the compare and the rename, so a contender can never win
 * the lock inside that window. A changed or missing record, or a guard another reaper holds, throws
 * `LockLeaseLostError`. Both steps are renames over the lock path, never unlink-and-create.
 */
export type LockLease = {
  readonly handOver: (pid: number) => Promise<void>
  readonly restore: () => Promise<void>
}

export type LockLeaseOptions = {
  readonly staleAfterMs?: number
  /** Test seam: runs inside the guard, after the compare and before the rename. */
  readonly beforeRestoreRename?: () => Promise<void>
}

const leaseTempPrefix = (lockPath: string) => `.${basename(lockPath)}.`
const LEASE_TEMP_SUFFIX = ".lease"

async function replaceRecord(lockPath: string, content: string): Promise<void> {
  const temporary = join(dirname(lockPath), `${leaseTempPrefix(lockPath)}${randomUUID()}${LEASE_TEMP_SUFFIX}`)
  try {
    const handle = await open(temporary, "wx", 0o600)
    try {
      await handle.writeFile(content)
    } finally {
      await handle.close()
    }
    await rename(temporary, lockPath)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}

// Only the lock's holder ever writes these temp files, and this process holds the lock now, so every one left in the
// directory for this lock is a leftover of a holder that crashed between its create and its rename.
async function removeLeftoverTemps(lockPath: string): Promise<void> {
  const prefix = leaseTempPrefix(lockPath)
  let entries: string[]
  try {
    entries = await readdir(dirname(lockPath))
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return
    throw error
  }
  for (const entry of entries) {
    if (entry.startsWith(prefix) && entry.endsWith(LEASE_TEMP_SUFFIX)) await rm(join(dirname(lockPath), entry), { force: true })
  }
}

async function currentRecord(lockPath: string): Promise<string | null> {
  try {
    return await readFile(lockPath, "utf8")
  } catch (error) {
    if (error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR")) return null
    throw error
  }
}

export function createLockLease(lockPath: string, ownerRecord: string, ownerTag: string, options: LockLeaseOptions = {}): LockLease {
  const staleAfterMs = options.staleAfterMs ?? Number.POSITIVE_INFINITY
  let handedTo: string | null = null
  return {
    async handOver(pid) {
      if (handedTo !== null) throw new Error("The lock is already handed over; restore it first.")
      if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) throw new Error(`Cannot hand the lock to pid ${pid}.`)
      if ((await currentRecord(lockPath)) !== ownerRecord) throw new LockLeaseLostError(lockPath)
      await removeLeftoverTemps(lockPath)
      const record = `${ownerTag} ${randomUUID()}\n${pid}\n${Date.now()}\n${randomUUID()}\n`
      await replaceRecord(lockPath, record)
      handedTo = record
    },
    async restore() {
      if (handedTo === null) throw new Error("The lock is not handed over.")
      const expected = handedTo
      handedTo = null
      const outcome = await withRecordGuard(lockPath, expected, staleAfterMs, {}, async () => {
        if ((await currentRecord(lockPath)) !== expected) return "lost" as const
        await options.beforeRestoreRename?.()
        await replaceRecord(lockPath, ownerRecord)
        return "restored" as const
      })
      if (outcome !== "restored") throw new LockLeaseLostError(lockPath)
    },
  }
}
