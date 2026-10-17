import { createHash } from "node:crypto"
import { unlink } from "node:fs/promises"

import { publishLockRecord } from "./lock-publish"
import {
  buildLockRecord,
  errorCode,
  isLockRecordStale,
  isPathAbsenceError,
  markLockRecordReleased,
  readLockRecord,
} from "./lock-record"

export type LockReclaimDeps = {
  readonly delay?: (ms: number) => Promise<void>
  readonly unlink?: typeof unlink
}

/**
 * removed: this call removed the expected record. absent: nothing is at the path. changed: the
 * path now holds another record, or the record is no longer stale. busy: another reclaimer of
 * the same record is mid-flight. stuck: the record could not be unlinked (Windows sharing
 * violation) and is still in place.
 */
export type LockReclaimOutcome = "removed" | "absent" | "changed" | "busy" | "stuck"

const RECLAIM_UNLINK_ATTEMPTS = 3
const RECLAIM_UNLINK_RETRY_MS = 25

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function reclaimGuardPath(lockPath: string, record: string): string {
  return `${lockPath}.reclaim-${createHash("sha256").update(record).digest("hex").slice(0, 16)}`
}

async function unlinkWithRetry(path: string, deps: LockReclaimDeps): Promise<"removed" | "absent" | "stuck"> {
  const wait = deps.delay ?? delay
  const unlinkFile = deps.unlink ?? unlink
  for (let attempt = 1; ; attempt += 1) {
    try {
      await unlinkFile(path)
      return "removed"
    } catch (error) {
      if (!(error instanceof Error)) throw error
      if (isPathAbsenceError(error)) return "absent"
      const code = errorCode(error)
      if ((code !== "EPERM" && code !== "EBUSY") || attempt === RECLAIM_UNLINK_ATTEMPTS) return "stuck"
      await wait(RECLAIM_UNLINK_RETRY_MS)
    }
  }
}

/**
 * Removes the lock at `lockPath` only if it still holds exactly `expectedRecord` and that record
 * is stale. Reading a record and unlinking the path are two steps, so a reclaimer acting on an
 * old observation could delete a fresh lock another process published in between. Every
 * reclaimer of the same record therefore first publishes a guard named after that record; under
 * the guard nobody else can remove the path, so the re-read and the unlink see the same file and
 * the record is removed exactly once. A guard left by a crashed reclaimer is itself a stale
 * record and is reclaimed the same way.
 */
export async function removeLockRecordIfUnchanged(
  lockPath: string,
  expectedRecord: string,
  staleAfterMs: number,
  deps: LockReclaimDeps = {},
): Promise<LockReclaimOutcome> {
  const guardPath = reclaimGuardPath(lockPath, expectedRecord)
  const guardRecord = buildLockRecord("lock-reclaim")
  if (!(await publishLockRecord(guardPath, guardRecord))) {
    const guard = await readLockRecord(guardPath)
    if (guard !== null && isLockRecordStale(guard, staleAfterMs)) {
      await removeLockRecordIfUnchanged(guardPath, guard.content, staleAfterMs, deps)
    }
    return "busy"
  }

  try {
    const current = await readLockRecord(lockPath)
    if (current === null) return "absent"
    if (current.content !== expectedRecord || !isLockRecordStale(current, staleAfterMs)) return "changed"
    const unlinked = await unlinkWithRetry(lockPath, deps)
    return unlinked === "absent" ? "absent" : unlinked
  } finally {
    markLockRecordReleased(guardRecord)
    await unlinkWithRetry(guardPath, deps)
  }
}
