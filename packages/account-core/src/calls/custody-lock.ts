import { randomUUID } from "node:crypto"
import { link, readFile, unlink, writeFile } from "node:fs/promises"
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
// pid is gone, or the process under it now started at another time. A live holder's lock is never broken; a call waits
// at most LOCK_WAIT_MS for it, then reports its record unwritten.

export const LOCK_WAIT_MS = 2000
const RETRY_MS = 5

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
  const holder = holderOf(await readFile(path, "utf8").catch(() => ""))
  return holder !== undefined && (await provenDead(holder))
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
  await writeFile(staged, JSON.stringify({ pid: process.pid, start: await getProcessStartIdentity(process.pid) }), {
    mode: 0o600,
  })
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

/** Runs `action` holding the log's lock, waiting at most until `deadline`; undefined when the lock was not had. */
export async function withCustodyLock<T>(
  logPath: string,
  action: () => Promise<T>,
  deadline: number = Date.now() + LOCK_WAIT_MS,
): Promise<T | undefined> {
  const lockPath = `${logPath}.lock`
  for (;;) {
    if (await take(lockPath)) break
    if (await breakIfDead(lockPath)) continue
    if (Date.now() >= deadline) return undefined
    else await delay(RETRY_MS)
  }
  try {
    return await action()
  } finally {
    await unlink(lockPath).catch(() => undefined)
  }
}
