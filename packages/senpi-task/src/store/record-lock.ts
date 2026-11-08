import { randomUUID } from "node:crypto"
import {
  closeSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeSync,
} from "node:fs"
import { dirname } from "node:path"

import { formatLockBody, isLockOwnerProvenDead, parseLockOwner } from "./lock-owner"

const LOCK_RETRY_MS = 10
// A waiter gives up only when ONE holder keeps the lock this long. Holders that each finish promptly
// hand the lock on, and a waiter queued behind any number of them keeps waiting: a busy lock never
// fails an acquisition, only a holder that stops making progress does.
const LOCK_HOLDER_WAIT_MS = 1_000
// A lock is taken from its holder only on proof that the holder is dead (lock-owner.ts); age alone
// never expires a lock. The one exception is a lock with no parseable owner - its writer died between
// the create and the write, which takes microseconds - once it is older than this window.
// The async holder still refreshes the mtime so that builds which expire locks by age leave it alone.
const LOCK_STALE_MS = 5_000
// A reaped lock the filesystem refuses to unlink (a Windows sharing violation while a scanner or the
// dead holder's last handle closes) is retried briefly, then waited on like a held lock - as team-core does (#9034).
const REAP_UNLINK_ATTEMPTS = 3
const REAP_UNLINK_RETRY_MS = 25
// On win32 a lock file that is being deleted while another process still has it open (a reader of its
// body) stays in the directory, delete-pending, until that handle closes; every open of it meanwhile -
// the exclusive create included - fails EPERM/EACCES. That is a lock in transition, not a failure:
// it is waited on like a held lock and judged again once the name is free.
const DELETE_PENDING = "delete-pending"
const sleeper = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT))

export function withTaskRecordLock<T>(recordPath: string, operation: () => T, options: TaskRecordLockOptions = {}): T {
  const lockPath = `${recordPath}.lock`
  mkdirSync(dirname(lockPath), { recursive: true })
  const token = acquireLock(lockPath, options.holderWaitMs ?? LOCK_HOLDER_WAIT_MS)
  try {
    return operation()
  } finally {
    releaseLock(lockPath, token)
  }
}

export interface TaskRecordLockOptions {
  /** How long ONE live holder may keep the lock before a waiter gives up; sized to what holders of this lock do. */
  readonly holderWaitMs?: number
}

export async function withTaskRecordLockAsync<T>(
  recordPath: string,
  operation: () => Promise<T>,
  options: TaskRecordLockOptions = {},
): Promise<T> {
  const lockPath = `${recordPath}.lock`
  mkdirSync(dirname(lockPath), { recursive: true })
  const token = await acquireLockAsync(lockPath, options.holderWaitMs ?? LOCK_HOLDER_WAIT_MS)
  const heartbeat = setInterval(() => refreshLock(lockPath), LOCK_STALE_MS / 2)
  heartbeat.unref()
  try {
    return await operation()
  } finally {
    clearInterval(heartbeat)
    releaseLock(lockPath, token)
  }
}

/** `held` names the holder (its lock file and body, which carries the acquisition token). */
type AcquireAttempt = { readonly acquired: string } | { readonly held: string } | "retry"

function acquireLock(lockPath: string, holderWaitMs: number): string {
  const waitOn = holderWait(lockPath, holderWaitMs)
  for (;;) {
    const attempt = tryAcquire(lockPath)
    if (attempt === "retry") continue
    if ("acquired" in attempt) return attempt.acquired
    waitOn(attempt.held)
    Atomics.wait(sleeper, 0, 0, LOCK_RETRY_MS)
  }
}

async function acquireLockAsync(lockPath: string, holderWaitMs: number): Promise<string> {
  const waitOn = holderWait(lockPath, holderWaitMs)
  for (;;) {
    const attempt = tryAcquire(lockPath)
    if (attempt === "retry") continue
    if ("acquired" in attempt) return attempt.acquired
    waitOn(attempt.held)
    await new Promise<void>((resolve) => setTimeout(resolve, LOCK_RETRY_MS))
  }
}

function holderWait(lockPath: string, holderWaitMs: number): (holder: string) => void {
  let current: string | undefined
  let since = 0
  return (holder) => {
    const now = Date.now()
    if (holder !== current) {
      current = holder
      since = now
      return
    }
    if (now - since >= holderWaitMs) {
      throw new Error(`Timed out acquiring task record lock: ${lockPath} (${describeHolder(holder)} for ${now - since}ms)`)
    }
  }
}

// Names what the waiter was stuck behind, so a timeout tells a slow live holder from a lock in transition.
function describeHolder(holder: string): string {
  if (holder === DELETE_PENDING) return "a delete-pending lock file"
  const owner = parseLockOwner(holder.split(":").slice(2).join(":"))
  return owner === undefined ? "a lock with no parseable owner" : `held by pid ${owner.pid}`
}

function tryAcquire(lockPath: string): AcquireAttempt {
  const token = randomUUID()
  if (publishLock(lockPath, token)) return { acquired: token }
  return reapAbandonedLock(lockPath)
}

function publishLock(lockPath: string, token: string): boolean {
  let fd: number
  try {
    fd = openSync(lockPath, "wx")
  } catch (error) {
    if (hasCode(error, "EEXIST")) return false
    if (isWindowsSharingError(error) && lockNameOccupied(lockPath)) return false
    throw error
  }
  try {
    writeSync(fd, formatLockBody(token))
  } finally {
    closeSync(fd)
  }
  return true
}

interface LockIdentity {
  readonly dev: number
  readonly ino: number
  readonly mtimeMs: number
  readonly body: string
}

export type RecordLockReapStage = "recovery_held" | "judged_unchanged"
let reapHook: ((stage: RecordLockReapStage, lockPath: string) => void) | undefined

/** Test seam: steps a reaper inside its window between the judgement and the unlink. */
export function setRecordLockReapHookForTests(hook: typeof reapHook): () => void {
  const previous = reapHook
  reapHook = hook
  return () => {
    reapHook = previous
  }
}

function isAbandoned(lock: LockIdentity): boolean {
  const owner = parseLockOwner(lock.body)
  return owner === undefined ? Date.now() - lock.mtimeMs > LOCK_STALE_MS : isLockOwnerProvenDead(owner)
}

/**
 * Removes a lock whose owner is proven dead. Reapers serialize on `<lock>.recovery`: while one holds
 * it, the judged lock can change only by that reaper (its dead owner never releases, and nobody
 * creates over an existing file), so re-reading it unchanged and unlinking it can never remove a
 * fresh holder's lock. A lock that changed since the judgement is simply judged again.
 */
function reapAbandonedLock(lockPath: string): AcquireAttempt {
  const judged = readLockIdentity(lockPath)
  if (judged === undefined) return "retry"
  if (judged === DELETE_PENDING) return { held: DELETE_PENDING }
  const held = { held: `${judged.dev}:${judged.ino}:${judged.body}` }
  if (!isAbandoned(judged)) return held
  const recoveryPath = `${lockPath}.recovery`
  const recoveryToken = randomUUID()
  if (!publishLock(recoveryPath, recoveryToken)) {
    if (!reclaimAbandonedRecoveryLock(recoveryPath) || !publishLock(recoveryPath, recoveryToken)) return held
  }
  try {
    reapHook?.("recovery_held", lockPath)
    const current = readLockIdentity(lockPath)
    if (current === DELETE_PENDING) return { held: DELETE_PENDING }
    if (current === undefined || !isSameLock(current, judged)) return "retry"
    reapHook?.("judged_unchanged", lockPath)
    // Fence: a reaper that lost its recovery lock (see below) must not unlink the primary.
    if (readToken(recoveryPath) !== recoveryToken) return held
    return unlinkReapedLock(lockPath) ? "retry" : held
  } finally {
    releaseLock(recoveryPath, recoveryToken)
  }
}

/**
 * A recovery lock is held for microseconds, so one left behind means its reaper died; it is reclaimed
 * on the same proof. Rename is atomic - exactly one reclaimer obtains the file - and a file that is no
 * longer the judged one is handed back with link. Only when two reapers died in a row can that
 * hand-back lose to a third reaper; the fence in reapAbandonedLock keeps the loser off the primary.
 */
function reclaimAbandonedRecoveryLock(recoveryPath: string): boolean {
  const judged = readLockIdentity(recoveryPath)
  if (judged === undefined) return true
  if (judged === DELETE_PENDING || !isAbandoned(judged)) return false
  const tombstone = `${recoveryPath}.reaping-${randomUUID()}`
  try {
    renameSync(recoveryPath, tombstone)
  } catch (error) {
    if (hasCode(error, "ENOENT")) return true
    if (isWindowsSharingError(error)) return false
    throw error
  }
  const moved = readLockIdentity(tombstone)
  // A tombstone already being deleted cannot be handed back, and the recovery name is free either way.
  const reclaimed = moved === undefined || moved === DELETE_PENDING || isSameLock(moved, judged)
  if (!reclaimed) {
    try {
      linkSync(tombstone, recoveryPath)
    } catch (error) {
      if (!hasCode(error, "EEXIST")) throw error
    }
  }
  rmSync(tombstone, { force: true })
  return reclaimed
}

function readLockIdentity(lockPath: string): LockIdentity | undefined | typeof DELETE_PENDING {
  try {
    const stat = statSync(lockPath)
    return { dev: stat.dev, ino: stat.ino, mtimeMs: stat.mtimeMs, body: readFileSync(lockPath, "utf8") }
  } catch (error) {
    if (hasCode(error, "ENOENT")) return undefined
    if (isWindowsSharingError(error)) return DELETE_PENDING
    throw error
  }
}

/** Whether a create refused with a sharing error met a (delete-pending) file, not a real permission failure. */
function lockNameOccupied(lockPath: string): boolean {
  try {
    statSync(lockPath)
    return true
  } catch (error) {
    return isWindowsSharingError(error)
  }
}

function isSameLock(left: LockIdentity, right: LockIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.mtimeMs === right.mtimeMs && left.body === right.body
}

// Only the acquisition that wrote the token releases the lock: a holder whose lock expired and was
// reaped must not delete the lock the next process has since taken.
function releaseLock(lockPath: string, token: string): void {
  if (readToken(lockPath) === token) rmSync(lockPath, { force: true })
}

function readToken(lockPath: string): string | undefined {
  try {
    return readFileSync(lockPath, "utf8").split("\n")[2]
  } catch (error) {
    if (hasCode(error, "ENOENT")) return undefined
    throw error
  }
}

function refreshLock(lockPath: string): void {
  const now = new Date()
  try {
    utimesSync(lockPath, now, now)
  } catch (error) {
    if (!hasCode(error, "ENOENT")) console.error("Task record lock heartbeat failed", error)
  }
}

function unlinkReapedLock(lockPath: string): boolean {
  for (let attempt = 1; ; attempt += 1) {
    try {
      rmSync(lockPath, { force: true })
      return true
    } catch (error) {
      if (!hasCode(error, "EPERM") && !hasCode(error, "EBUSY")) throw error
      if (attempt === REAP_UNLINK_ATTEMPTS) return false
      Atomics.wait(sleeper, 0, 0, REAP_UNLINK_RETRY_MS)
    }
  }
}

function isWindowsSharingError(error: unknown): boolean {
  return process.platform === "win32" && ["EBUSY", "EPERM", "EACCES"].some((code) => hasCode(error, code))
}

function hasCode(error: unknown, expected: string): boolean {
  return error instanceof Error && "code" in error && error.code === expected
}
