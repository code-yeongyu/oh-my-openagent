// A domain-specific counting lease admits at most N holders, in ticket order.
//
//   <locks>/<purpose>.slot-1.lock ... <purpose>.slot-N.lock   one lock file per slot
//   <locks>/<purpose>.tickets/<issue>-<seq>-<pid>-<uuid>.ticket   the FIFO queue
//
// A slot is an `acquireLock` file, so a slot whose owner died is reclaimed by the same proof-based
// policy as every other lock (pid liveness, then start identity; never age). A ticket is a lock
// record too: only the ticket at the head of the queue may take a slot, and a head ticket left by a
// dead process is reaped on the same proof, so a crash between enqueue and acquire can never freeze
// the queue. Waiters park on a delay between polls - a wait that ends in a slot, a busy
// verdict or the caller's abort, and withdraws the ticket in every one of those cases. Ticket names
// are assigned synchronously and published in issue order within a process, so contenders started in
// one process queue in call order; across processes the millisecond timestamp orders them.

import { randomUUID } from "node:crypto"
import path from "node:path"

import { mkdir, readdir, readFile, readFileSync, rename, unlink, unlinkSync, writeFile } from "../fs/resilient"
import { LockContentionError, acquireLock, isLockOwnerProvenDead, releaseLock } from "./acquire"
import { delay, lockRetryDelayMs } from "./retry-delay"
import { createLockRecord, parseLockRecord, type LockRecord } from "./lock-record"

const TICKET_SUFFIX = ".ticket"

export type CountingLeaseOptions = {
  /** Slots this contender may take (1..N); defaults to the domain's count. */
  readonly maxConcurrent?: number
  /** Total time to wait; 0 means one pass, Infinity means no queue timeout. */
  readonly waitTimeoutMs?: number
  /** First pause between queue polls while waiting; later pauses back off from it. */
  readonly retryDelayMs?: number
  readonly signal?: AbortSignal
}

export type CountingLease = {
  /** 1-based slot this lease holds. */
  readonly slot: number
  /** True when this lease's record was the one removed; false when it was already gone. */
  readonly release: () => Promise<boolean>
  /** Exit handlers cannot await; only this owner's nonce may be removed. */
  readonly releaseSync: () => boolean
  /** Keep the slot occupied if the supervisor dies while its gated child survives. */
  readonly retainFor: (pid: number, processStart: string | null) => Promise<void>
}

export interface CountingLeaseDomain {
  readonly purpose: string
  readonly defaultSlots: number
  readonly waitTimeoutMs: number
  readonly busyError: (waitedMs: number, maxConcurrent: number) => Error
}

export function countingLeaseLockPath(locksDirectory: string, purpose: string, slot: number): string {
  if (!Number.isInteger(slot) || slot < 1) throw new Error(`${purpose} slot must be a positive integer, got ${slot}`)
  return path.join(locksDirectory, `${purpose}.slot-${slot}.lock`)
}

export function countingLeaseTicketDirectory(locksDirectory: string, purpose: string): string {
  return path.join(locksDirectory, `${purpose}.tickets`)
}

let ticketSequence = 0
/** In-process publication order: a later ticket is never visible before an earlier one. */
let publishing: Promise<unknown> = Promise.resolve()

export interface CountingLeaseTicketFs {
  readonly readFile?: (filePath: string, encoding: "utf8") => Promise<string>
  readonly isSharingError?: (error: unknown) => boolean
}

let ticketFs: CountingLeaseTicketFs = {}

/** Test seam for deterministic Windows ticket-sharing coverage; production uses resilient fs. */
export function setCountingLeaseTicketFsForTests(next: CountingLeaseTicketFs | undefined): () => void {
  const previous = ticketFs
  ticketFs = next ?? {}
  return () => { ticketFs = previous }
}

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

function isTicketReadSharingError(error: unknown): boolean {
  if (ticketFs.isSharingError !== undefined) return ticketFs.isSharingError(error)
  if (process.platform !== "win32") return false
  const code = errorCode(error)
  return code === "EBUSY" || code === "EPERM" || code === "EACCES"
}

/** Reaps the head ticket when its owner is proven dead; an unreadable or unparsable ticket keeps its place. */
async function reapDeadHead(ticketDirectory: string, head: string): Promise<boolean> {
  const ticketPath = path.join(ticketDirectory, head)
  let raw: string
  try {
    raw = await (ticketFs.readFile ?? readFile)(ticketPath, "utf8")
  } catch (error) {
    // Gone already: its owner acquired or withdrew between our readdir and this read.
    if (errorCode(error) === "ENOENT") return true
    // Windows can deny the open while the ticket owner is publishing or withdrawing it. The
    // unreadable ticket remains the queue head; wait for the next normal poll instead of rejecting.
    if (isTicketReadSharingError(error)) return false
    throw error
  }
  const owner = parseLockRecord(raw)
  if (owner === null || !(await isLockOwnerProvenDead(owner))) return false
  await unlinkIfPresent(ticketPath)
  return true
}

async function takeAnySlot(locksDirectory: string, record: LockRecord, maxConcurrent: number, signal: AbortSignal | undefined): Promise<CountingLease | undefined> {
  for (let slot = 1; slot <= maxConcurrent; slot += 1) {
    const lockPath = countingLeaseLockPath(locksDirectory, record.purpose, slot)
    try {
      // One pass per slot: publish, or recover a proven-dead owner and publish, or report contention.
      await acquireLock(lockPath, record, { waitTimeoutMs: 0, ...(signal === undefined ? {} : { signal }) })
      return { slot, release: () => releaseLock(lockPath, record), retainFor: async (pid, processStart) => {
        const staging = `${lockPath}.handoff-${record.nonce}`
        try {
          await writeFile(staging, `${JSON.stringify({
            ...record, pid, process_start: processStart ?? "unavailable", git_activity_lock: undefined,
          })}\n`, { mode: 0o600 })
          await rename(staging, lockPath)
        } finally {
          await unlinkIfPresent(staging)
        }
      }, releaseSync: () => {
        try {
          if (parseLockRecord(readFileSync(lockPath, "utf8"))?.nonce !== record.nonce) return false
          unlinkSync(lockPath)
          return true
        } catch (error) {
          if (errorCode(error) === "ENOENT") return false
          throw error
        }
      } }
    } catch (error) {
      if (error instanceof LockContentionError) continue
      throw error
    }
  }
  return undefined
}

/** Takes a FIFO ticket, waits for a slot, and withdraws the ticket in every settled case. */
export async function acquireCountingLease(
  locksDirectory: string,
  domain: CountingLeaseDomain,
  options: CountingLeaseOptions = {},
): Promise<CountingLease> {
  const maxConcurrent = options.maxConcurrent ?? domain.defaultSlots
  const waitTimeoutMs = options.waitTimeoutMs ?? domain.waitTimeoutMs
  const retryDelayMs = options.retryDelayMs ?? 25
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) throw new Error(`${domain.purpose} maxConcurrent must be a positive integer, got ${maxConcurrent}`)
  if (waitTimeoutMs < 0 || retryDelayMs <= 0) throw new Error("lock wait options must be positive")
  const { signal } = options
  const ticketDirectory = countingLeaseTicketDirectory(locksDirectory, domain.purpose)
  const name = ticketName()
  const started = Date.now()
  const deadline = started + waitTimeoutMs

  const published = publishing.then(async () => {
    signal?.throwIfAborted()
    await publishTicket(ticketDirectory, name, await createLockRecord(`${domain.purpose}:ticket`))
  })
  publishing = published.catch(() => undefined)
  try {
    await published
    const record = await createLockRecord(domain.purpose)
    for (let attempt = 0; ; attempt += 1) {
      signal?.throwIfAborted()
      const queue = await listTickets(ticketDirectory)
      const head = queue[0]
      if (head === undefined || !queue.includes(name)) {
        // Our ticket vanished from under us (a sweep of the directory); take a fresh place in line.
        await publishTicket(ticketDirectory, name, await createLockRecord(`${domain.purpose}:ticket`))
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
      if (now >= deadline) throw domain.busyError(now - started, maxConcurrent)
      await delay(Math.min(lockRetryDelayMs(attempt, retryDelayMs), Math.max(1, deadline - now)), signal)
    }
  } finally {
    await unlinkIfPresent(path.join(ticketDirectory, name)).catch(() => undefined)
  }
}

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !("code" in error)) return undefined
  return typeof error.code === "string" ? error.code : undefined
}
