import { hostname } from "node:os"
import path from "node:path"

import { lstat, readdir, readFile, unlink } from "../fs/resilient"
import { LockContentionError, acquireWithoutDirectorySweep } from "./acquire-core"
import { CANDIDATE_STALE_AGE_MS } from "./candidate-sweep"
import { releaseLock } from "./lock-owner"
import { isLockOwnerProvenDead } from "./stale-owner"
import { createLockRecord, parseLockRecord, type LockRecord } from "./lock-record"
import { getPidLiveness } from "./process-identity"

const LOCK_FILE_SUFFIX = ".lock"
// A reaper renames a lock file to `<lock>.reaping-<uuid>` only to inspect it, then hands it back or unlinks it
// within the same acquisition, so a tombstone that outlives that was left by a reaper that crashed or failed.
// Its record is never restored: once the file left the lock path its holder's fence refused, and that holder
// has released since (#15273 review H1). The rename sets the tombstone's ctime, which its age is measured from.
const REAPING_NAME = /\.lock(?:\.recovery)?\.reaping-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
export const REAPING_STALE_AGE_MS = CANDIDATE_STALE_AGE_MS

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
  /** The clock a leftover reaping tombstone's age is judged by; tests pass a fixed one. */
  readonly now?: () => number
}

async function removeAbandonedTombstone(tombstonePath: string, now: number): Promise<void> {
  const status = await lstat(tombstonePath)
  if (!status.isFile() || now - status.ctimeMs <= REAPING_STALE_AGE_MS) return
  await unlink(tombstonePath)
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
  const now = options.now ?? Date.now
  let reclaimed = 0
  for (const name of names) {
    const tombstone = REAPING_NAME.test(name)
    if (!tombstone && !name.endsWith(LOCK_FILE_SUFFIX)) continue
    const lockPath = path.join(lockDirectory, name)
    try {
      if (tombstone) await removeAbandonedTombstone(lockPath, now())
      else if (await reclaimIfDeadOwner(lockPath, options)) reclaimed += 1
    } catch (error) {
      // A tombstone gone before this sweep reached it was collected by another sweep or its own reaper.
      if (!(tombstone && errorCode(error) === "ENOENT")) options.onFailure?.(lockPath, error)
    }
  }
  return reclaimed
}
