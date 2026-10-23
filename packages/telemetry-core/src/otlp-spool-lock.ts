import { randomUUID } from "node:crypto"
import { closeSync, lstatSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from "node:fs"
import { open, readFile } from "node:fs/promises"
import { join } from "node:path"

import { lockName } from "./otlp-spool-names"

/**
 * The exclusive lock for moving one spool file to a name a competitor would not choose (a claim, a
 * lease renewal, a lease reclaim, a dead owner's seal). A rename to DIFFERENT destinations does not
 * pick one winner on Windows: two racing renames of one source can both report success. Creating
 * `<source>.lock` with O_EXCL (CREATE_NEW on Windows) is atomic everywhere, so exactly one competitor
 * moves the file and every other one skips it.
 *
 * Each lock holds its owner's token (`<pid> <boot id> <nonce>`). A mover moves only while the lock still
 * holds its own token, and deletes only its own lock: a lock the sweep judged abandoned, or the opt-out
 * purge deleted, may by then be another mover's, and that one must not be moved past or unlocked.
 */
export type LockOwner = { readonly pid: number; readonly bootId: string }

const newToken = (owner: LockOwner): string => `${owner.pid} ${owner.bootId} ${randomUUID()}`

function code(error: unknown): unknown {
  return error instanceof Error && "code" in error ? error.code : undefined
}

function isBusy(error: unknown): boolean {
  // A lock another competitor is deleting stays "delete pending" on Windows, and opening it fails EPERM.
  const c = code(error)
  return c === "EEXIST" || c === "ENOENT" || (c === "EPERM" && process.platform === "win32")
}

function removeQuietly(path: string): void {
  try {
    unlinkSync(path)
  } catch (error) {
    if (code(error) !== "ENOENT") throw error
  }
}

/** The lock's token, or null when another mover holds it. A lock this call created but could not fill is removed. */
export function tryLockSync(dir: string, source: string, owner: LockOwner): string | null {
  const path = join(dir, lockName(source))
  let fd: number
  try {
    fd = openSync(path, "wx")
  } catch (error) {
    if (isBusy(error)) return null
    throw error
  }
  const token = newToken(owner)
  try {
    writeSync(fd, token)
  } catch (error) {
    cleanUpThenThrow(error, () => closeSync(fd), path)
  }
  closeSync(fd)
  return token
}

/** Off the event loop, like the claim rename it guards: a stalled synchronous call would hold every timer. */
export async function tryLock(dir: string, source: string, owner: LockOwner): Promise<string | null> {
  const path = join(dir, lockName(source))
  let handle: Awaited<ReturnType<typeof open>>
  try {
    handle = await open(path, "wx")
  } catch (error) {
    if (isBusy(error)) return null
    throw error
  }
  const token = newToken(owner)
  try {
    await handle.writeFile(token)
  } catch (error) {
    let closeError: unknown
    await handle.close().catch((thrown: unknown) => {
      closeError = thrown
    })
    cleanUpThenThrow(error, () => {
      if (closeError !== undefined) throw closeError
    }, path)
  }
  await handle.close()
  return token
}

export function holdsLockSync(dir: string, source: string, token: string): boolean {
  try {
    return readFileSync(join(dir, lockName(source)), "utf8") === token
  } catch (error) {
    if (code(error) === "ENOENT") return false
    throw error
  }
}

export async function holdsLock(dir: string, source: string, token: string): Promise<boolean> {
  try {
    return (await readFile(join(dir, lockName(source)), "utf8")) === token
  } catch (error) {
    if (code(error) === "ENOENT") return false
    throw error
  }
}

/**
 * Deletes the lock only while it still holds `token`. Never throws: it runs in the `finally` of a move
 * that may already have happened, and an error here would replace that result. A lock it cannot delete
 * goes to `onLeft`; the sweep deletes it once it is abandoned (`isAbandonedLock`).
 */
export function unlock(dir: string, source: string, token: string, onLeft?: (error: unknown) => void): void {
  try {
    if (!holdsLockSync(dir, source, token)) return
    unlinkSync(join(dir, lockName(source)))
  } catch (error) {
    if (code(error) === "ENOENT") return
    onLeft?.(error)
  }
}

/**
 * A lock is held for one rename. Past the claim lease it is abandoned when its owner's pid is gone (or
 * the token is unreadable: a crash between creating and filling it); a live pid may be a suspended
 * holder, so its lock stays until the spool's age limit, past which it is abandoned whoever holds the pid.
 */
export function isAbandonedLock(
  dir: string,
  name: string,
  ageMs: number,
  limits: {
    readonly leaseMs: number
    readonly maxAgeMs: number
    readonly isPidAlive: (pid: number) => boolean
    readonly self: LockOwner
  },
): boolean {
  if (ageMs < limits.leaseMs) return false
  if (ageMs > limits.maxAgeMs) return true
  let text: string
  try {
    text = readFileSync(join(dir, name), "utf8")
  } catch (error) {
    if (code(error) === "ENOENT") return false
    throw error
  }
  const [pidText, bootId] = text.split(" ")
  const pid = Number(pidText)
  if (!Number.isInteger(pid) || pid <= 0) return true
  // Our own pid answers "alive" by definition: only the boot id tells this process from a crashed earlier one.
  if (pid === limits.self.pid) return bootId !== limits.self.bootId
  return !limits.isPidAlive(pid)
}

/**
 * A move that failed may still have left its destination (Windows renames by copy, then unlink).
 * Puts the spool back to exactly one copy under the source name, then throws the move's error. If the
 * rollback fails too, both errors are thrown. A leftover claim (a claim or a renewal) returns to the
 * spool when its lease ends; a leftover sealed batch (a reclaim or a seal) is simply that batch.
 */
export function throwAfterRollBack(dir: string, from: string, to: string, error: unknown): never {
  try {
    // No exists(to) pre-check: a competitor may take `to` (a sealed batch name, for a reclaim or a seal) at
    // any moment, so ENOENT here means the spool already holds one copy and the rollback is done.
    if (exists(join(dir, from))) unlinkSync(join(dir, to))
    else renameSync(join(dir, to), join(dir, from))
  } catch (rollbackError) {
    if (code(rollbackError) !== "ENOENT") {
      throw new AggregateError([error, rollbackError], "spool move failed and its rollback failed")
    }
  }
  throw error
}

/** Rethrows the lock-fill error; a cleanup that also fails is thrown with it, never in its place. */
function cleanUpThenThrow(error: unknown, close: () => void, path: string): never {
  const cleanupErrors: unknown[] = []
  for (const step of [close, () => removeQuietly(path)]) {
    try {
      step()
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError)
    }
  }
  if (cleanupErrors.length > 0) throw new AggregateError([error, ...cleanupErrors], "spool lock fill failed and its cleanup failed")
  throw error
}

function exists(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch (error) {
    if (code(error) === "ENOENT") return false
    throw error
  }
}
