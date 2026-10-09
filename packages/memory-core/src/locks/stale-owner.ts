import { randomUUID } from "node:crypto"
import { link, rename, unlink } from "../fs/resilient"
import { hostname } from "node:os"

import type { LockRecord } from "./lock-record"
import { isSameOwner, readOwner, releaseLock, type OwnerSnapshot } from "./lock-owner"
import { getPidLiveness, getProcessStartIdentity, startIdentitiesConflict } from "./process-identity"
import { isUnlinkSharingError, publishExclusive } from "./publish"

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !("code" in error)) return undefined
  return typeof error.code === "string" ? error.code : undefined
}

/**
 * The one stale-owner policy every lock domain shares: an owner is dead only on proof - a pid the
 * kernel no longer knows, or a live pid whose start identity contradicts the recorded one (the pid
 * was recycled). Another host, an unknown liveness or an incomparable identity all keep the owner.
 */
export async function isLockOwnerProvenDead(owner: LockRecord): Promise<boolean> {
  if (owner.hostname !== hostname()) return false
  const liveness = getPidLiveness(owner.pid)
  if (liveness === "dead") return true
  if (liveness === "unknown") return false

  const actualStart = await getProcessStartIdentity(owner.pid)
  if (actualStart === null || owner.process_start === "unavailable") return false
  return startIdentitiesConflict(owner.process_start, actualStart)
}

// The recovery lock's only remover is its holder's nonce-matched releaseLock, so a holder
// SIGKILLed inside recoverStaleOwner leaks a file that would otherwise block every future
// eviction of the primary. Apply the same proven-dead test the primary gets; an incomplete
// record stays held through the same grace period before it can be reclaimed.
//
// rename-then-inspect instead of unlink: rename is atomic, so exactly one reaper obtains the
// inode. If the bytes it obtained are not the dead record it saw, another contender already
// reaped that record and published a fresh live holder in between, so the file is handed back
// with link (EEXIST means yet another contender republished first, and nothing is lost).
// The tombstone name must not match LEAKED_CANDIDATE_NAME in candidate-sweep.ts, otherwise a
// concurrent stale-candidate sweep could delete it while it is still being inspected.
async function isRecoverableOwner(owner: OwnerSnapshot, now: number, incompleteLockGraceMs: number): Promise<boolean> {
  if (owner.record !== null) return isLockOwnerProvenDead(owner.record)
  return now - owner.mtimeMs > incompleteLockGraceMs
}

async function reclaimStaleRecoveryLock(
  recoveryPath: string,
  now: number,
  incompleteLockGraceMs: number,
): Promise<boolean> {
  const stale = await readOwner(recoveryPath)
  if (stale === null || !(await isRecoverableOwner(stale, now, incompleteLockGraceMs))) return false

  const tombstonePath = `${recoveryPath}.reaping-${randomUUID()}`
  try {
    await rename(recoveryPath, tombstonePath)
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false
    // Windows refuses to rename a file another process holds open; leave it to that holder.
    if (isUnlinkSharingError(error)) return false
    throw error
  }

  const moved = await readOwner(tombstonePath)
  if (moved !== null && isSameOwner(moved, stale)) {
    await unlink(tombstonePath)
    return true
  }

  try {
    await link(tombstonePath, recoveryPath)
  } catch (error) {
    if (errorCode(error) !== "EEXIST") throw error
  }
  await unlink(tombstonePath)
  return false
}

export async function recoverStaleOwner(
  lockPath: string,
  snapshot: OwnerSnapshot,
  contender: LockRecord,
  now: number,
  incompleteLockGraceMs: number,
): Promise<boolean> {
  if (!(await isRecoverableOwner(snapshot, now, incompleteLockGraceMs))) return false

  const recoveryPath = `${lockPath}.recovery`
  const recoveryRecord: LockRecord = {
    ...contender,
    nonce: randomUUID(),
    created_at: new Date().toISOString(),
    purpose: `${contender.purpose}:recovery`,
  }
  // Bounded to one reclaim and one re-publish so a waitTimeoutMs: 0 caller (the bind-time
  // reconcile path) recovers a doubly-stale lock in a single pass without introducing a spin.
  for (let attempt = 0; ; attempt += 1) {
    // Read before publishing, as for the primary: while a live contender visibly holds the recovery
    // lock, a publish here is a doomed create+fsync+link+unlink cycle repeated on every retry tick.
    const recoveryOwner = await readOwner(recoveryPath)
    if (recoveryOwner === null && (await publishExclusive(recoveryPath, recoveryRecord))) break
    if (attempt > 0 || !(await reclaimStaleRecoveryLock(recoveryPath, now, incompleteLockGraceMs))) return false
  }

  try {
    const current = await readOwner(lockPath)
    if (current === null) return true
    if (!isSameOwner(current, snapshot)) return false
    if (!(await isRecoverableOwner(current, now, incompleteLockGraceMs))) return false
    // Fence: only unlink the primary while this contender still owns the recovery lock. A
    // reaper that grabbed our live record and handed it back may have lost that hand-back to
    // a third contender's publish; in that case the critical section is no longer ours.
    const fence = await readOwner(recoveryPath)
    if (fence === null || fence.record?.nonce !== recoveryRecord.nonce) return false
    await unlink(lockPath)
    return true
  } finally {
    await releaseLock(recoveryPath, recoveryRecord)
  }
}
