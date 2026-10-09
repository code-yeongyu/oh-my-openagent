import { stat } from "../fs/resilient"
import path from "node:path"

import { acquireWithoutDirectorySweep, type AcquireLockOptions } from "./acquire-core"
import { sweepStaleLockCandidates } from "./candidate-sweep"
import { sweepDeadOwnerLocks } from "./dead-owner-sweep"
import type { LockRecord } from "./lock-record"
import { releaseLock } from "./lock-owner"
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
    await sweepDeadOwnerLocks(lockDirectory)
  }
  return acquireWithoutDirectorySweep(lockPath, record, options)
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
