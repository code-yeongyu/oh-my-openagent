import { randomUUID } from "node:crypto"
import { link, open, readFile, stat, unlink } from "node:fs/promises"
import { setTimeout as delay } from "node:timers/promises"

import { type NamedProcess, processScope, processStart, processState } from "./process-scope"

// The custody log's own lock (security design 8.2, decision D22-17; reviews 6065710236 N1 and N4, 6066498814 Y2,
// 6067451001 L1, 6067671766 L3): every append and the recovery step take it, so a prune never drops a record appended
// while it ran and two recoveries never close one operation twice. It is a file beside the log, created whole (written
// aside, then linked into place) naming its holder by pid, start identity and scope. It is broken only:
// - when that holder is proven gone in this reader's own scope (process-scope.ts),
// - when it was written in another scope and is older than FOREIGN_SCOPE_BREAK_AGE_MS (a hold lasts milliseconds), or
// - when it names no holder (a crash inside the take) and is older than HOLDERLESS_BREAK_AGE_MS.
// A live holder in this scope is never broken. A wait ends PATIENCE_MS after the holder last changed and never later than
// WAIT_CAP_MS: a holder that stays costs one patience, a queue that keeps moving is not starved.

const PATIENCE_MS = 2000
const WAIT_CAP_MS = 6000
const RETRY_MS = 5
/** A lock that names no holder (a crash inside the take): broken past this age. */
export const HOLDERLESS_BREAK_AGE_MS = 5000
/** A lock whose holder is in another process-number space, which this reader cannot judge: broken past this age. */
export const FOREIGN_SCOPE_BREAK_AGE_MS = 60_000

export type LockWait = { readonly patienceMs: number; readonly capMs: number }
export const DEFAULT_WAIT: LockWait = { patienceMs: PATIENCE_MS, capMs: WAIT_CAP_MS }
/** One attempt, no waiting: for a step that may be skipped while another call holds the lock. */
export const NO_WAIT: LockWait = { patienceMs: 0, capMs: 0 }

function holderOf(text: string): NamedProcess | undefined {
  try {
    const value = JSON.parse(text) as { pid?: unknown; start?: unknown; scope?: unknown }
    if (typeof value.pid !== "number" || !Number.isInteger(value.pid) || value.pid <= 0) return undefined
    return {
      pid: value.pid,
      start: typeof value.start === "string" ? value.start : null,
      ...(typeof value.scope === "string" ? { scope: value.scope } : {}),
    }
  } catch {
    return undefined
  }
}

async function breakable(path: string): Promise<boolean> {
  const text = await readFile(path, "utf8").catch(() => undefined)
  if (text === undefined) return false
  const held = await stat(path).catch(() => undefined)
  const age = held === undefined ? 0 : Date.now() - held.mtimeMs
  const holder = holderOf(text)
  if (holder === undefined) return age > HOLDERLESS_BREAK_AGE_MS
  const state = await processState(holder)
  return state === "gone" || (state === "elsewhere" && age > FOREIGN_SCOPE_BREAK_AGE_MS)
}

// Breakers are serialized by a second lock beside the first. Under it, the lock is judged again and removed: no taker can
// create the lock meanwhile (it exists until removed) and no other breaker can remove it, so a lock taken by a live
// waiter is never the one removed. A break lock is removed by the same judgement.
async function breakIfBreakable(lockPath: string): Promise<boolean> {
  const breakPath = `${lockPath}.break`
  if (!(await take(breakPath))) {
    if (await breakable(breakPath)) await unlink(breakPath).catch(() => undefined)
    return false
  }
  try {
    if (!(await breakable(lockPath))) return false
    await unlink(lockPath).catch(() => undefined)
    return true
  } finally {
    await unlink(breakPath).catch(() => undefined)
  }
}

async function take(lockPath: string): Promise<boolean> {
  const staged = `${lockPath}.${randomUUID()}.taking`
  const [start, scope] = await Promise.all([processStart(process.pid), processScope()])
  const handle = await open(staged, "wx", 0o600)
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid, start, scope }))
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

/** Runs `action` holding the log's lock, or answers undefined when `wait` ran out first. */
export async function withCustodyLock<T>(
  logPath: string,
  action: () => Promise<T>,
  wait: LockWait = DEFAULT_WAIT,
): Promise<T | undefined> {
  const lockPath = `${logPath}.lock`
  const started = Date.now()
  let holder: string | undefined
  let changed = started
  for (;;) {
    if (await take(lockPath)) break
    if (await breakIfBreakable(lockPath)) continue
    const seen = await readFile(lockPath, "utf8").catch(() => undefined)
    const now = Date.now()
    if (seen !== holder) {
      holder = seen
      changed = now
    }
    if (now - changed >= wait.patienceMs || now - started >= wait.capMs) return undefined
    await delay(RETRY_MS)
  }
  try {
    return await action()
  } finally {
    await unlink(lockPath).catch(() => undefined)
  }
}
