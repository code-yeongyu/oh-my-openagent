import { randomUUID } from "node:crypto"
import { link, rename, unlink } from "../fs/resilient"
import { hostname } from "node:os"

import type { LockRecord } from "./lock-record"
import { isSameOwner, readOwner, releaseLock, type OwnerSnapshot } from "./lock-owner"
import { getPidLiveness, getProcessStartIdentity, startIdentitiesConflict } from "./process-identity"
import { recordProvenDeadTakeover } from "./proven-dead-takeovers"
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
  if (liveness === "unknown") return false
  if (liveness === "alive") {
    const actualStart = await getProcessStartIdentity(owner.pid)
    if (actualStart === null || !startIdentitiesConflict(owner.process_start, actualStart)) return false
  }
  const pgid = owner.posix_pgid
  if (pgid === undefined) return true
  // Signal 0 is only an existence probe. Only ESRCH proves the whole group is gone;
  // an orphan, a recycled group number, EPERM or an invalid record keeps the slot.
  return process.platform !== "win32" && pgid !== null && Number.isSafeInteger(pgid) && pgid > 1 && pgid <= 0x7fffffff
    ? getPidLiveness(-pgid) === "dead"
    : false
}

// The recovery lock's only remover is its holder's nonce-matched releaseLock, so a holder
// SIGKILLed inside recoverStaleOwner leaks a file that would otherwise block every future
// eviction of the primary. Apply the same proven-dead test the primary gets; an incomplete
// record stays held through the same grace period before it can be reclaimed.
//
// rename-then-inspect instead of unlink: rename is atomic, so exactly one reaper obtains the
// inode. If the bytes it obtained are not the dead record it saw, another contender already
// reaped that record and published a fresh live holder in between, so the file is handed back
// with link (EEXIST means yet another contender republished first, and nothing is lost: the
// displaced holder's fence refuses once its record left the path). A tombstone a dead-owner sweep
// collected meanwhile reads as gone, which leaves the recovery path free to publish.
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
  if (moved === null) return true
  if (isSameOwner(moved, stale)) {
    await unlinkUnlessGone(tombstonePath)
    return true
  }

  try {
    await link(tombstonePath, recoveryPath)
  } catch (error) {
    const code = errorCode(error)
    if (code !== "EEXIST" && code !== "ENOENT") throw error
  }
  await unlinkUnlessGone(tombstonePath)
  return false
}

async function unlinkUnlessGone(target: string): Promise<void> {
  try {
    await unlink(target)
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error
  }
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
    try {
      await unlink(lockPath)
    } catch (error) {
      // The proven-dead primary vanished between the fence read and this unlink (Windows CI,
      // #11644): it is already reclaimed. Every other failure still surfaces.
      if (errorCode(error) !== "ENOENT") throw error
    }
    // Record the reclaimed previous owner so consumers that gate on dead-owner evidence (the
    // stranded-git-lock sweep) can prove reclamation after the lock file itself is republished;
    // the proof is bound to the contender's acquisition nonce (omo #10199 r5 MEDIUM 3).
    if (current.record !== null) recordProvenDeadTakeover(lockPath, current.record, contender.nonce)
    return true
  } finally {
    await releaseLock(recoveryPath, recoveryRecord)
  }
}
