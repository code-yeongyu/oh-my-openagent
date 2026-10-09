import { hostname } from "node:os"
import path from "node:path"

import { lstat, readdir, readFile } from "../fs/resilient"
import { LockContentionError, acquireWithoutDirectorySweep } from "./acquire-core"
import { releaseLock } from "./lock-owner"
import { isLockOwnerProvenDead } from "./stale-owner"
import { createLockRecord, parseLockRecord } from "./lock-record"
import { getPidLiveness } from "./process-identity"

const LOCK_FILE_SUFFIX = ".lock"

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !("code" in error)) return undefined
  return typeof error.code === "string" ? error.code : undefined
}

async function ownerIsProvenDead(lockPath: string): Promise<boolean> {
  let raw: string
  try {
    raw = await readFile(lockPath, "utf8")
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false
    throw error
  }
  const owner = parseLockRecord(raw)
  // A sweep checks only owners whose pid is already gone; a live pid would cost a start-identity probe
  // (a process spawn) per lock on every sweep. A recycled pid is still caught by the next contender.
  if (owner === null || owner.hostname !== hostname() || getPidLiveness(owner.pid) !== "dead") return false
  return isLockOwnerProvenDead(owner)
}

export interface DeadOwnerSweepOptions {
  /** Called for each lock (or the directory) the sweep could not inspect or reclaim; the sweep goes on. */
  readonly onFailure?: (lockPath: string, error: unknown) => void
}

async function reclaimIfDeadOwner(lockPath: string): Promise<boolean> {
  const status = await lstat(lockPath).catch(() => undefined)
  if (status === undefined || !status.isFile() || !(await ownerIsProvenDead(lockPath))) return false
  const sweeper = await createLockRecord("dead-owner-sweep")
  try {
    await acquireWithoutDirectorySweep(lockPath, sweeper, { waitTimeoutMs: 0 })
  } catch (error) {
    if (error instanceof LockContentionError) return false
    throw error
  }
  await releaseLock(lockPath, sweeper)
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
      if (await reclaimIfDeadOwner(lockPath)) reclaimed += 1
    } catch (error) {
      options.onFailure?.(lockPath, error)
    }
  }
  return reclaimed
}
