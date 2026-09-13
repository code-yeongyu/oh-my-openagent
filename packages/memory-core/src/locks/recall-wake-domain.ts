// The machine-wide recall-wake domain: a counting lease that admits at most N concurrent Kibitzer
// wakes per machine, in ticket order.
//
//   <locks>/recall-wake.slot-1.lock ... recall-wake.slot-N.lock   one ordinary lock file per slot
//   <locks>/recall-wake.tickets/<issue>-<seq>-<pid>-<uuid>.ticket   the FIFO queue
//
// A slot is an `acquireLock` file, so a slot whose owner died is reclaimed by the same proof-based
// policy as every other lock (pid liveness, then start identity; never age). A ticket is a lock
// record too: only the ticket at the head of the queue may take a slot, and a head ticket left by a
// dead process is reaped on the same proof, so a crash between enqueue and acquire can never freeze
// the queue. Waiters park on a delay between polls - a bounded wait that ends in a slot, a busy
// verdict or the caller's abort, and withdraws the ticket in every one of those cases. Ticket names
// are assigned synchronously and published in issue order within a process, so contenders started in
// one process queue in call order; across processes the millisecond timestamp orders them.

import { randomUUID } from "node:crypto"
import path from "node:path"

import { mkdir, readdir, readFile, rename, unlink, writeFile } from "../fs/resilient"
import { LockContentionError, acquireLock, delay, isLockOwnerProvenDead, releaseLock } from "./acquire"
import { createLockRecord, parseLockRecord, type LockRecord } from "./lock-record"

/** Concurrent wakes one machine admits when the caller names no count (`memory.recall.max_concurrent_wakes`). */
export const RECALL_WAKE_DEFAULT_SLOTS = 2

const SLOT_PURPOSE = "recall-wake"
const TICKET_PURPOSE = "recall-wake:ticket"
const TICKET_SUFFIX = ".ticket"

export type RecallWakeLeaseOptions = {
  /** Slots this contender may take (1..N); defaults to {@link RECALL_WAKE_DEFAULT_SLOTS}. */
  readonly maxConcurrent?: number
  /** Total time to wait for a slot before {@link RecallWakeBusyError}; 0 means one pass. */
  readonly waitTimeoutMs?: number
  /** Pause between queue polls while waiting. */
  readonly retryDelayMs?: number
  readonly signal?: AbortSignal
}

export type RecallWakeLease = {
  /** 1-based slot this lease holds. */
  readonly slot: number
  /** True when this lease's record was the one removed; false when it was already gone. */
  readonly release: () => Promise<boolean>
}

/** Every slot stayed with a live owner for the whole wait budget: retry later, nothing is wrong. */
export class RecallWakeBusyError extends Error {
  readonly retriable = true

  constructor(readonly waitedMs: number, readonly maxConcurrent: number) {
    super(`recall-wake: all ${maxConcurrent} slot(s) busy after ${waitedMs}ms`)
    this.name = "RecallWakeBusyError"
  }
}

export function recallWakeLockPath(locksDirectory: string, slot: number): string {
  if (!Number.isInteger(slot) || slot < 1) throw new Error(`recall-wake slot must be a positive integer, got ${slot}`)
  return path.join(locksDirectory, `recall-wake.slot-${slot}.lock`)
}

export function recallWakeTicketDirectory(locksDirectory: string): string {
  return path.join(locksDirectory, "recall-wake.tickets")
}

let ticketSequence = 0
/** In-process publication order: a later ticket is never visible before an earlier one. */
let publishing: Promise<unknown> = Promise.resolve()

function ticketName(): string {
  ticketSequence = (ticketSequence + 1) % 1_000_000
  const issued = String(Date.now()).padStart(16, "0")
  const sequence = String(ticketSequence).padStart(6, "0")
  const pid = String(process.pid).padStart(10, "0")
  return `${issued}-${sequence}-${pid}-${randomUUID()}${TICKET_SUFFIX}`
}

async function publishTicket(ticketDirectory: string, name: string, record: LockRecord): Promise<void> {
  await mkdir(ticketDirectory, { recursive: true, mode: 0o700 })
  // Written whole under a temporary name, then renamed: a `.ticket` file is complete or absent.
  const staging = path.join(ticketDirectory, `${name}.staging`)
  await writeFile(staging, `${JSON.stringify(record)}\n`, { mode: 0o600 })
  await rename(staging, path.join(ticketDirectory, name))
}

async function listTickets(ticketDirectory: string): Promise<string[]> {
  try {
    return (await readdir(ticketDirectory)).filter((name) => name.endsWith(TICKET_SUFFIX)).sort()
  } catch (error) {
    if (errorCode(error) === "ENOENT") return []
    throw error
  }
}

async function unlinkIfPresent(filePath: string): Promise<void> {
  try {
    await unlink(filePath)
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error
  }
}

/** Reaps the head ticket when its owner is proven dead; an unreadable or unparsable ticket keeps its place. */
async function reapDeadHead(ticketDirectory: string, head: string): Promise<boolean> {
  const ticketPath = path.join(ticketDirectory, head)
  let raw: string
  try {
    raw = await readFile(ticketPath, "utf8")
  } catch (error) {
    // Gone already: its owner acquired or withdrew between our readdir and this read.
    if (errorCode(error) === "ENOENT") return true
    throw error
  }
  const owner = parseLockRecord(raw)
  if (owner === null || !(await isLockOwnerProvenDead(owner))) return false
  await unlinkIfPresent(ticketPath)
  return true
}

async function takeAnySlot(locksDirectory: string, record: LockRecord, maxConcurrent: number, signal: AbortSignal | undefined): Promise<RecallWakeLease | undefined> {
  for (let slot = 1; slot <= maxConcurrent; slot += 1) {
    const lockPath = recallWakeLockPath(locksDirectory, slot)
    try {
      // One pass per slot: publish, or recover a proven-dead owner and publish, or report contention.
      await acquireLock(lockPath, record, { waitTimeoutMs: 0, ...(signal === undefined ? {} : { signal }) })
      return { slot, release: () => releaseLock(lockPath, record) }
    } catch (error) {
      if (error instanceof LockContentionError) continue
      throw error
    }
  }
  return undefined
}

/** Takes a ticket, waits (bounded) for the head of the queue and a free slot, and withdraws the ticket in every case. */
export async function acquireRecallWakeLease(
  locksDirectory: string,
  options: RecallWakeLeaseOptions = {},
): Promise<RecallWakeLease> {
  const maxConcurrent = options.maxConcurrent ?? RECALL_WAKE_DEFAULT_SLOTS
  const waitTimeoutMs = options.waitTimeoutMs ?? 0
  const retryDelayMs = options.retryDelayMs ?? 25
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) throw new Error(`recall-wake maxConcurrent must be a positive integer, got ${maxConcurrent}`)
  if (waitTimeoutMs < 0 || retryDelayMs <= 0) throw new Error("lock wait options must be positive")
  const { signal } = options
  const ticketDirectory = recallWakeTicketDirectory(locksDirectory)
  const name = ticketName()
  const started = Date.now()
  const deadline = started + waitTimeoutMs

  const published = publishing.then(async () => {
    signal?.throwIfAborted()
    await publishTicket(ticketDirectory, name, await createLockRecord(TICKET_PURPOSE))
  })
  publishing = published.catch(() => undefined)
  try {
    await published
    const record = await createLockRecord(SLOT_PURPOSE)
    for (;;) {
      signal?.throwIfAborted()
      const queue = await listTickets(ticketDirectory)
      const head = queue[0]
      if (head === undefined || !queue.includes(name)) {
        // Our ticket vanished from under us (a sweep of the directory); take a fresh place in line.
        await publishTicket(ticketDirectory, name, await createLockRecord(TICKET_PURPOSE))
      } else if (head === name) {
        const lease = await takeAnySlot(locksDirectory, record, maxConcurrent, signal)
        if (lease !== undefined) {
          try {
            await unlinkIfPresent(path.join(ticketDirectory, name))
          } catch (error) {
            // A ticket we cannot withdraw would block the queue for as long as we live: give the
            // slot back and let the caller see the filesystem failure rather than leak the lease.
            await lease.release()
            throw error
          }
          return lease
        }
      } else if (await reapDeadHead(ticketDirectory, head)) {
        // The queue moved without anyone acquiring: look again at once, no pause owed.
        continue
      }
      const now = Date.now()
      if (now >= deadline) throw new RecallWakeBusyError(now - started, maxConcurrent)
      await delay(Math.min(retryDelayMs, Math.max(1, deadline - now)), signal)
    }
  } finally {
    await unlinkIfPresent(path.join(ticketDirectory, name)).catch(() => undefined)
  }
}

export async function withRecallWakeLease<T>(
  locksDirectory: string,
  fn: (lease: RecallWakeLease) => Promise<T>,
  options?: RecallWakeLeaseOptions,
): Promise<T> {
  const lease = await acquireRecallWakeLease(locksDirectory, options)
  try {
    return await fn(lease)
  } finally {
    await lease.release()
  }
}

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !("code" in error)) return undefined
  return typeof error.code === "string" ? error.code : undefined
}
