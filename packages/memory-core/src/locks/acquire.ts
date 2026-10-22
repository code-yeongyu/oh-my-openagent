import { stat } from "../fs/resilient"
import path from "node:path"

import { acquireWithoutDirectorySweep, type AcquireLockOptions } from "./acquire-core"
import { sweepStaleLockCandidates } from "./candidate-sweep"
import { sweepDeadOwnerLocks } from "./dead-owner-sweep"
import type { LockRecord } from "./lock-record"
import { releaseLock } from "./lock-owner"
import { provenDeadTakeoverFor, recordProvenDeadTakeover } from "./proven-dead-takeovers"
import { currentCandidateFs } from "./publish"
import { claimDirectorySweep, rearmCandidateSweep } from "./sweep-memo"

export { LockContentionError, acquireWithoutDirectorySweep, type AcquireLockOptions } from "./acquire-core"
export { releaseLock } from "./lock-owner"
export { isCandidatePublishRace, setLockCandidateFsForTests, type LockCandidateFs } from "./publish"
export { isLockOwnerProvenDead } from "./stale-owner"
export { LOCK_DIRECTORY_SWEEP_INTERVAL_MS } from "./sweep-memo"

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !("code" in error)) return undefined
  return typeof error.code === "string" ? error.code : undefined
}

export async function acquireLock(
  lockPath: string,
  record: LockRecord,
  options: AcquireLockOptions = {},
): Promise<void> {
  const lockDirectory = path.dirname(lockPath)
  let reclaimedForThisAcquisition: LockRecord | undefined
  if (claimDirectorySweep(lockDirectory, (options.now ?? Date.now)())) {
    // Opportunistic hygiene: a failed sweep must never block or fail the acquisition it rides on.
    // A candidate it could not remove re-arms the sweep; a dead-owner lock it could not read or
    // reclaim is skipped until the next interval (never re-armed, so one bad file cannot make every
    // acquisition rescan the directory), and `memory doctor`'s lock check reports what is left.
    const candidateFs = currentCandidateFs()
    await sweepStaleLockCandidates(lockDirectory, Date.now, {
      ...(candidateFs.unlink === undefined ? {} : { unlink: candidateFs.unlink }),
      ...(candidateFs.isSharingError === undefined ? {} : { isSharingError: candidateFs.isSharingError }),
      onFailure: () => rearmCandidateSweep(lockDirectory),
    }).catch(() => {
      rearmCandidateSweep(lockDirectory)
    })
    await sweepDeadOwnerLocks(lockDirectory, {
      onReclaimed: (reclaimedPath, previousOwner) => {
        if (path.resolve(reclaimedPath) === path.resolve(lockPath)) reclaimedForThisAcquisition = previousOwner
      },
    })
  }
  const outcome = await acquireWithoutDirectorySweep(lockPath, record, options)
  // The hygiene sweep reclaimed THIS lock from a proven-dead owner on behalf of this acquisition, so
  // the takeover proof belongs to it (omo #10199 r5 MEDIUM 3) - but only when nobody held the lock
  // in between: an owner seen during the acquisition is the dead owner's successor (r5 delta LOW).
  // A takeover the contender performed itself (stale-owner.ts) already bound its own proof and wins.
  if (reclaimedForThisAcquisition !== undefined && !outcome.sawOtherOwner && provenDeadTakeoverFor(lockPath, record.nonce) === undefined) {
    recordProvenDeadTakeover(lockPath, reclaimedForThisAcquisition, record.nonce)
  }
}

export async function withLock<T>(
  lockPath: string,
  record: LockRecord,
  fn: () => Promise<T>,
  options?: AcquireLockOptions,
): Promise<T> {
  await acquireLock(lockPath, record, options)
  try {
    return await fn()
  } finally {
    await releaseLock(lockPath, record)
  }
}

export async function isHeld(lockPath: string): Promise<boolean> {
  try {
    await stat(lockPath)
    return true
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false
    throw error
  }
}
