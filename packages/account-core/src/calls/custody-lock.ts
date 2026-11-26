import { randomUUID } from "node:crypto"
import { link, open, readFile, stat, unlink } from "node:fs/promises"
import { setTimeout as delay } from "node:timers/promises"

import {
  getPidLiveness,
  getProcessStartIdentity,
  startIdentitiesConflict,
} from "@oh-my-opencode/memory-core/process-identity"

// The custody log's own lock (security design 8.2; reviews 6065710236 N1 and N4, 6066498814 Y1 and Y2, with the security
// owner's ruling on Y2): every append and the recovery step take it, so a prune never drops a record appended while it
// ran and two recoveries never close one operation twice. It is a file beside the log, created whole (written aside,
// then linked into place) with its holder's pid and start identity, and broken ONLY when that holder is proven dead: the
// pid is gone, or the process under it now started at another time. A live holder's lock is never broken; one call
// spends at most LOCK_WAIT_MS waiting for it in total, then reports what it could not write as unwritten.

export const LOCK_WAIT_MS = 2000
const RETRY_MS = 5
/**
 * A lock is created whole, so a live holder's lock always names it. One that names no holder was left by a crash or a
 * power loss inside the take; past this age it is treated as a dead holder's (review 6067451001 L1). That makes a flush
 * before the link unneeded, and a flush per take cost every call a disk sync under contention (review 6067671766 L3).
 */
const HOLDERLESS_GRACE_MS = 5000

type Holder = { readonly pid: number; readonly start: string | null }

function holderOf(text: string): Holder | undefined {
  try {
    const value = JSON.parse(text) as Partial<Holder>
    return typeof value.pid === "number" && Number.isInteger(value.pid) && value.pid > 0
      ? { pid: value.pid, start: typeof value.start === "string" ? value.start : null }
      : undefined
  } catch {
    return undefined
  }
}

async function provenDead(holder: Holder): Promise<boolean> {
  if (getPidLiveness(holder.pid) === "dead") return true
  if (holder.start === null) return false
  const now = await getProcessStartIdentity(holder.pid)
  return now !== null && startIdentitiesConflict(holder.start, now)
}

async function holderDead(path: string): Promise<boolean> {
  const text = await readFile(path, "utf8").catch(() => undefined)
  if (text === undefined) return false
  const holder = holderOf(text)
  if (holder !== undefined) return provenDead(holder)
  const held = await stat(path).catch(() => undefined)
  return held !== undefined && Date.now() - held.mtimeMs > HOLDERLESS_GRACE_MS
}

// Breakers are serialized by a second lock beside the first. Under it, the lock is judged again and removed: no taker can
// create the lock meanwhile (it exists until removed) and no other breaker can remove it, so a lock taken by a live
// waiter is never the one removed. A break lock whose own holder is proven dead is removed the same way it was judged.
async function breakIfDead(lockPath: string): Promise<boolean> {
  const breakPath = `${lockPath}.break`
  if (!(await take(breakPath))) {
    if (await holderDead(breakPath)) await unlink(breakPath).catch(() => undefined)
    return false
  }
  try {
    if (!(await holderDead(lockPath))) return false
    await unlink(lockPath).catch(() => undefined)
    return true
  } finally {
    await unlink(breakPath).catch(() => undefined)
  }
}

async function take(lockPath: string): Promise<boolean> {
  const staged = `${lockPath}.${randomUUID()}.taking`
  const handle = await open(staged, "wx", 0o600)
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid, start: await getProcessStartIdentity(process.pid) }))
  } finally {
    await handle.close()
  }
  try {
    await link(staged, lockPath)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
    return false
  } finally {
    await unlink(staged).catch(() => undefined)
  }
}

/** The time one call may still spend waiting for the lock; only waiting draws on it, never the operation's own run. */
export type LockWait = { remainingMs: number }

/** Runs `action` holding the log's lock, waiting at most what `wait` has left; undefined when the lock was not had. */
export async function withCustodyLock<T>(
  logPath: string,
  action: () => Promise<T>,
  wait: LockWait = { remainingMs: LOCK_WAIT_MS },
): Promise<T | undefined> {
  const lockPath = `${logPath}.lock`
  const started = Date.now()
  const deadline = started + wait.remainingMs
  let taken = false
  for (;;) {
    if (await take(lockPath)) {
      taken = true
      break
    }
    if (await breakIfDead(lockPath)) continue
    if (Date.now() >= deadline) break
    await delay(RETRY_MS)
  }
  wait.remainingMs = Math.max(0, wait.remainingMs - (Date.now() - started))
  if (!taken) return undefined
  try {
    return await action()
  } finally {
    await unlink(lockPath).catch(() => undefined)
  }
}
