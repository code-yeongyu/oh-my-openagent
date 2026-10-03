import { randomUUID } from "node:crypto"
import {
  EINTR_RETRY_CAP,
  link,
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
  writeHandleAll,
} from "../fs/resilient"

import type { FileHandle } from "../fs/resilient"
import { hostname } from "node:os"
import path from "node:path"

import {
  CANDIDATE_UNLINK_ATTEMPTS,
  forgetLeakedCandidate,
  sweepStaleLockCandidates,
  trackLeakedCandidate,
} from "./candidate-sweep"
import type { LockRecord } from "./lock-record"
import { parseLockRecord } from "./lock-record"
import { getPidLiveness, getProcessStartIdentity, startIdentitiesConflict } from "./process-identity"

export type AcquireLockOptions = {
  readonly waitTimeoutMs?: number
  readonly retryDelayMs?: number
  readonly incompleteLockGraceMs?: number
  readonly now?: () => number
  readonly signal?: AbortSignal
}

type OwnerSnapshot = {
  readonly raw: string
  readonly record: LockRecord | null
  readonly dev: bigint | number
  readonly ino: bigint | number
  readonly mtimeMs: number
}

const INCOMPLETE_LOCK_GRACE_MS = 5_000
const LINK_FALLBACK_ERRORS = new Set(["EACCES", "EPERM", "ENOTSUP"])

export class LockContentionError extends Error {
  readonly retriable = true

  constructor(
    readonly lockPath: string,
    readonly owner: LockRecord | null,
  ) {
    super(`Lock is held: ${lockPath}`)
    this.name = "LockContentionError"
  }
}

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !("code" in error)) return undefined
  return typeof error.code === "string" ? error.code : undefined
}

function isUnlinkSharingError(error: unknown, override?: (error: unknown) => boolean): boolean {
  if (override !== undefined) return override(error)
  if (process.platform !== "win32") return false
  const code = errorCode(error)
  return code === "EBUSY" || code === "EPERM" || code === "EACCES"
}

async function unlinkCandidate(candidatePath: string): Promise<boolean> {
  for (let attempt = 0; attempt < CANDIDATE_UNLINK_ATTEMPTS; attempt += 1) {
    try {
      await (candidateFs.unlink ?? unlink)(candidatePath)
      forgetLeakedCandidate(candidatePath)
      return true
    } catch (error) {
      if (errorCode(error) === "ENOENT") {
        forgetLeakedCandidate(candidatePath)
        return true
      }
      const sharing = isUnlinkSharingError(error, candidateFs.isSharingError)
      if (!sharing) {
        trackLeakedCandidate(candidatePath)
        rearmCandidateSweep(path.dirname(candidatePath))
        throw error
      }
      if (attempt + 1 === CANDIDATE_UNLINK_ATTEMPTS) {
        trackLeakedCandidate(candidatePath)
        rearmCandidateSweep(path.dirname(candidatePath))
        return false
      }
    }
  }
  return false
}

/** Resolves after `milliseconds`, or rejects with the signal's reason the moment it aborts. */
export function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(finish, milliseconds)
    const onAbort = () => finish(signal?.reason ?? new DOMException("The operation was aborted", "AbortError"))
    signal?.addEventListener("abort", onAbort, { once: true })
    function finish(error?: unknown) {
      clearTimeout(timer)
      signal?.removeEventListener("abort", onAbort)
      error === undefined ? resolve() : reject(error)
    }
  })
}

async function readOwner(lockPath: string): Promise<OwnerSnapshot | null> {
  try {
    const raw = await readFile(lockPath, "utf8")
    const identity = await stat(lockPath, { bigint: true })
    return {
      raw,
      record: parseLockRecord(raw),
      dev: identity.dev,
      ino: identity.ino,
      mtimeMs: Number(identity.mtimeMs),
    }
  } catch (error) {
    const code = errorCode(error)
    if (code === "ENOENT") return null
    if (path.sep === "\\" && code === "EPERM") return { raw: "", record: null, dev: 0, ino: 0, mtimeMs: Date.now() }
    throw error
  }
}

// Exclusive creates are ambiguous under EINTR (the candidate may exist afterwards), and the
// candidate name is a per-attempt UUID, so recovery is simply: discard that name and retry
// with a fresh one. Anything the interrupted open did create is unlinked best-effort.
async function openFreshCandidate(
  lockPath: string,
): Promise<{ readonly candidatePath: string; readonly handle: FileHandle }> {
  for (let attempt = 0; ; attempt += 1) {
    const candidatePath = `${lockPath}.candidate-${randomUUID()}`
    try {
      return { candidatePath, handle: await open(candidatePath, "wx", 0o600) }
    } catch (error) {
      const removed = await unlinkCandidate(candidatePath)
      if (!removed) rearmCandidateSweep(path.dirname(lockPath))
      if (errorCode(error) !== "EINTR" || attempt >= EINTR_RETRY_CAP) throw error
    }
  }
}

async function publishFallback(lockPath: string, record: LockRecord): Promise<boolean> {
  let handle: FileHandle
  try {
    handle = await open(lockPath, "wx", 0o600)
  } catch (error) {
    if (errorCode(error) === "EEXIST") return false
    throw error
  }
  try {
    await (candidateFs.writeFallback ?? writeHandleAll)(handle, `${JSON.stringify(record)}\n`, "utf8")
    await handle.sync()
    return true
  } finally {
    await handle.close()
  }
}

async function publishExclusive(lockPath: string, record: LockRecord): Promise<boolean> {
  await mkdir(path.dirname(lockPath), { recursive: true, mode: 0o700 })
  const { candidatePath, handle } = await openFreshCandidate(lockPath)
  try {
    try {
      await writeHandleAll(handle, `${JSON.stringify(record)}\n`, "utf8")
      await handle.sync()
    } finally {
      await handle.close()
    }

    try {
      await (candidateFs.link ?? link)(candidatePath, lockPath)
      return true
    } catch (error) {
      if (isCandidatePublishRace(error)) return false
      // Awaited so the finally below removes the candidate only after the fallback settles; a bare
      // return would leave a fallback rejection unhandled while the candidate unlink is pending.
      if (LINK_FALLBACK_ERRORS.has(errorCode(error) ?? "")) return await publishFallback(lockPath, record)
      throw error
    }
  } finally {
    if (!(await unlinkCandidate(candidatePath))) rearmCandidateSweep(path.dirname(lockPath))
  }
}

// EEXIST: another contender published first. ENOENT: this candidate vanished mid-publish,
// which only another process's stale-candidate sweep can cause after CANDIDATE_STALE_AGE_MS;
// both are lost races the caller retries with a fresh candidate, never protocol failures.
export function isCandidatePublishRace(error: unknown): boolean {
  const code = errorCode(error)
  return code === "EEXIST" || code === "ENOENT"
}

const sweptLockDirectories = new Set<string>()

export interface LockCandidateFs {
  readonly link?: typeof link
  readonly unlink?: (path: string) => Promise<void>
  readonly writeFallback?: typeof writeHandleAll
  readonly isSharingError?: (error: unknown) => boolean
}

let candidateFs: LockCandidateFs = {}

/** Test seam for deterministic Windows sharing-failure coverage; production uses resilient fs. */
export function setLockCandidateFsForTests(next: LockCandidateFs | undefined): () => void {
  const previous = candidateFs
  candidateFs = next ?? {}
  return () => { candidateFs = previous }
}

function rearmCandidateSweep(lockDirectory: string): void {
  sweptLockDirectories.delete(lockDirectory)
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
function isSameOwner(left: OwnerSnapshot, right: OwnerSnapshot): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.mtimeMs === right.mtimeMs && left.raw === right.raw
}

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

async function recoverStaleOwner(
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
    if (await publishExclusive(recoveryPath, recoveryRecord)) break
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

export async function acquireLock(
  lockPath: string,
  record: LockRecord,
  options: AcquireLockOptions = {},
): Promise<void> {
  const waitTimeoutMs = options.waitTimeoutMs ?? 0
  const retryDelayMs = options.retryDelayMs ?? 25
  const incompleteLockGraceMs = options.incompleteLockGraceMs ?? INCOMPLETE_LOCK_GRACE_MS
  const now = options.now ?? Date.now
  if (waitTimeoutMs < 0 || retryDelayMs <= 0 || incompleteLockGraceMs < 0) throw new Error("lock wait options must be positive")
  const lockDirectory = path.dirname(lockPath)
  if (!sweptLockDirectories.has(lockDirectory)) {
    sweptLockDirectories.add(lockDirectory)
    // Opportunistic hygiene, once per process per directory: a failed sweep must never
    // block or fail the acquisition it rides on. Failed candidate cleanup re-arms this memo.
    await sweepStaleLockCandidates(lockDirectory, Date.now, {
      ...(candidateFs.unlink === undefined ? {} : { unlink: candidateFs.unlink }),
      ...(candidateFs.isSharingError === undefined ? {} : { isSharingError: candidateFs.isSharingError }),
      onFailure: () => rearmCandidateSweep(lockDirectory),
    }).catch(() => {
      rearmCandidateSweep(lockDirectory)
    })
  }
  const deadline = now() + waitTimeoutMs

  for (;;) {
    options.signal?.throwIfAborted()
    // Read before publishing. `publishExclusive` creates a candidate file, writes it, FSYNCS it,
    // hard-links it and unlinks it - six filesystem operations, one of them durable - and while
    // another process visibly holds the lock every one of them is doomed. A waiter that retried
    // the publish instead of the read produced that whole cycle on every tick of its retry delay:
    // at the 5ms delay the two-process writer test uses, ~200 fsynced create/unlink cycles per
    // second, aimed at the same volume the lock holder was committing to. That is the load that
    // starved the Windows shard-1 writer test out of its 30s budget (#8323); the read costs one
    // open+read and cannot block the holder.
    let owner = await readOwner(lockPath)
    if (owner === null) {
      if (await publishExclusive(lockPath, record)) return
      options.signal?.throwIfAborted()
      // Lost the publish race: re-read so the contention error and the dead-owner check still see
      // the holder that won, exactly as the read-after-failed-publish order always did.
      owner = await readOwner(lockPath)
      if (owner === null) continue
    }
    if (await recoverStaleOwner(lockPath, owner, record, now(), incompleteLockGraceMs)) continue
    options.signal?.throwIfAborted()
    if (now() >= deadline) throw new LockContentionError(lockPath, owner.record)
    await delay(Math.min(retryDelayMs, Math.max(1, deadline - now())), options.signal)
  }
}

export async function releaseLock(lockPath: string, record: Pick<LockRecord, "nonce">): Promise<boolean> {
  const owner = await readOwner(lockPath)
  if (owner === null || owner.record?.nonce !== record.nonce) return false
  try {
    await unlink(lockPath)
    return true
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false
    throw error
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
