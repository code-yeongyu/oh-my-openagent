import { hostname } from "node:os"
import path from "node:path"

import { lstat, readdir, readFile } from "../fs/resilient"
import { LockContentionError, acquireWithoutDirectorySweep } from "./acquire-core"
import { releaseLock } from "./lock-owner"
import { isLockOwnerProvenDead } from "./stale-owner"
import { createLockRecord, parseLockRecord, type LockRecord } from "./lock-record"
import { getPidLiveness } from "./process-identity"

const LOCK_FILE_SUFFIX = ".lock"

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !("code" in error)) return undefined
  return typeof error.code === "string" ? error.code : undefined
}

async function provenDeadOwner(lockPath: string): Promise<LockRecord | null> {
  let raw: string
  try {
    raw = await readFile(lockPath, "utf8")
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null
    throw error
  }
  const owner = parseLockRecord(raw)
  // A sweep checks only owners whose pid is already gone; a live pid would cost a start-identity probe
  // (a process spawn) per lock on every sweep. A recycled pid is still caught by the next contender.
  if (owner === null || owner.hostname !== hostname() || getPidLiveness(owner.pid) !== "dead") return null
  return (await isLockOwnerProvenDead(owner)) ? owner : null
}

export interface DeadOwnerSweepOptions {
  /** Called for each lock (or the directory) the sweep could not inspect or reclaim; the sweep goes on. */
  readonly onFailure?: (lockPath: string, error: unknown) => void
  /** Called with the proven-dead owner of each lock the sweep reclaimed. */
  readonly onReclaimed?: (lockPath: string, previousOwner: LockRecord) => void
}

async function reclaimIfDeadOwner(lockPath: string, options: DeadOwnerSweepOptions): Promise<boolean> {
  const status = await lstat(lockPath).catch(() => undefined)
  const previousOwner = status?.isFile() === true ? await provenDeadOwner(lockPath) : null
  if (previousOwner === null) return false
  const sweeper = await createLockRecord("dead-owner-sweep")
  try {
    await acquireWithoutDirectorySweep(lockPath, sweeper, { waitTimeoutMs: 0 })
  } catch (error) {
    if (error instanceof LockContentionError) return false
    throw error
  }
  await releaseLock(lockPath, sweeper)
  options.onReclaimed?.(lockPath, previousOwner)
  return true
}

/**
 * Reclaims every `*.lock` in `lockDirectory` whose recorded owner's pid is gone on this host (the same
 * proof every contender applies; never age). A lock nobody contends for again is otherwise kept
 * forever. Reclaim goes through the acquire path with no wait, so it follows the same race-safe
 * recovery protocol every contender uses, and the lock is released at once. One lock that cannot be
 * read or reclaimed is reported through `onFailure` and skipped; the sweep never throws. Returns how
 * many were reclaimed.
 */
export async function sweepDeadOwnerLocks(lockDirectory: string, options: DeadOwnerSweepOptions = {}): Promise<number> {
  let names: readonly string[]
  try {
    names = await readdir(lockDirectory)
  } catch (error) {
    if (errorCode(error) !== "ENOENT") options.onFailure?.(lockDirectory, error)
    return 0
  }
  let reclaimed = 0
  for (const name of names) {
    if (!name.endsWith(LOCK_FILE_SUFFIX)) continue
    const lockPath = path.join(lockDirectory, name)
    try {
      if (await reclaimIfDeadOwner(lockPath, options)) reclaimed += 1
    } catch (error) {
      options.onFailure?.(lockPath, error)
    }
  }
  return reclaimed
}
