import { randomUUID } from "node:crypto"
import { open, rename, rm } from "node:fs/promises"

import { tolerantFsync } from "../tolerant-fsync"
import { publishLockRecord } from "./lock-publish"
import { removeLockRecordIfUnchanged, type LockReclaimDeps, type LockReclaimOutcome } from "./lock-reclaim"
import { buildLockRecord, isLockRecordStale, markLockRecordReleased, readLockRecord } from "./lock-record"

export { assertRetryableLockOpenError } from "./lock-publish"
export { lockOwnerInstanceId } from "./lock-record"

type LockOptions = {
  staleAfterMs?: number
  ownerTag?: string
}

type AtomicWriteDeps = {
  open?: typeof open
  rename?: typeof rename
  rm?: typeof rm
}

const LOCK_RETRY_MS = 50
const LOCK_WAIT_TIMEOUT_MS = 15_000
const DEFAULT_STALE_AFTER_MS = 300_000

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function acquireLock(lockPath: string, ownerTag: string, staleAfterMs: number): Promise<string> {
  const startedAt = Date.now()
  for (;;) {
    if (Date.now() - startedAt > LOCK_WAIT_TIMEOUT_MS) {
      throw new Error(`Timed out acquiring lock: ${lockPath}`)
    }

    const record = buildLockRecord(ownerTag)
    if (await publishLockRecord(lockPath, record)) return record

    const outcome = await reapStaleLock(lockPath, staleAfterMs)
    if (outcome === "removed" || outcome === "absent") continue
    await delay(LOCK_RETRY_MS)
  }
}

export async function withLock<T>(
  lockPath: string,
  fn: () => Promise<T>,
  opts?: LockOptions,
): Promise<T> {
  const staleAfterMs = opts?.staleAfterMs ?? DEFAULT_STALE_AFTER_MS
  const ownerTag = opts?.ownerTag ?? "owner"

  const record = await acquireLock(lockPath, ownerTag, staleAfterMs)

  try {
    return await fn()
  } finally {
    // Once released, the record counts as stale for this process, so a failed unlink leaves a
    // leftover that the next acquire reclaims instead of a lock nobody can ever take again.
    markLockRecordReleased(record)
    await removeLockRecordIfUnchanged(lockPath, record, staleAfterMs)
  }
}

export async function detectStaleLock(lockPath: string, staleAfterMs: number): Promise<boolean> {
  const observed = await readLockRecord(lockPath)
  return observed !== null && isLockRecordStale(observed, staleAfterMs)
}

export async function reapStaleLock(
  lockPath: string,
  staleAfterMs: number = DEFAULT_STALE_AFTER_MS,
  deps: LockReclaimDeps = {},
): Promise<LockReclaimOutcome> {
  const observed = await readLockRecord(lockPath)
  if (observed === null) return "absent"
  if (!isLockRecordStale(observed, staleAfterMs)) return "changed"
  return await removeLockRecordIfUnchanged(lockPath, observed.content, staleAfterMs, deps)
}

export async function atomicWrite(
  filePath: string,
  content: string | Buffer,
  deps: AtomicWriteDeps = {},
): Promise<void> {
  const tmpPath = `${filePath}.tmp.${randomUUID()}`
  const openFile = deps.open ?? open
  const renameFile = deps.rename ?? rename
  const removeFile = deps.rm ?? rm

  try {
    const fileHandle = await openFile(tmpPath, "wx")
    try {
      await fileHandle.writeFile(content)
      await tolerantFsync(fileHandle, `atomicWrite:${filePath}`)
    } finally {
      await fileHandle.close()
    }
    await renameFile(tmpPath, filePath)
  } catch (error) {
    await removeFile(tmpPath, { force: true })
    throw error
  }
}
