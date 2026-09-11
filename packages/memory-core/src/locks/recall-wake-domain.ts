import { randomUUID } from "node:crypto"
import { mkdir, readdir, unlink, writeFile } from "../fs/resilient"
import path from "node:path"
import { acquireLock, releaseLock } from "./acquire"
import { createLockRecord } from "./lock-record"

export type RecallWakeLeaseOptions = {
  readonly waitTimeoutMs?: number
  readonly retryDelayMs?: number
  readonly signal?: AbortSignal
}

export type RecallWakeLease = {
  readonly count: number
  readonly release: () => Promise<boolean>
}

export function recallWakeLockPath(locksDirectory: string): string {
  return path.join(locksDirectory, "recall-wake.lock")
}

function ticketDirectory(lockPath: string): string { return `${lockPath}.tickets` }

/** Acquire a FIFO, counting lease in the machine-wide recall/wake domain. */
export async function acquireRecallWakeLease(
  locksDirectory: string,
  options: RecallWakeLeaseOptions = {},
): Promise<RecallWakeLease> {
  const lockPath = recallWakeLockPath(locksDirectory)
  const tickets = ticketDirectory(lockPath)
  await mkdir(tickets, { recursive: true, mode: 0o700 })
  const ticket = path.join(tickets, `${String(Date.now()).padStart(16, "0")}-${randomUUID()}.ticket`)
  await writeFile(ticket, `${process.pid}\n`, { mode: 0o600 })
  const started = Date.now()
  const timeout = options.waitTimeoutMs ?? 0
  const delay = options.retryDelayMs ?? 25
  try {
    for (;;) {
      options.signal?.throwIfAborted()
      const names = (await readdir(tickets)).filter((name) => name.endsWith(".ticket")).sort()
      if (names[0] === path.basename(ticket)) {
        const record = await createLockRecord("recall-wake")
        try {
          await acquireLock(lockPath, record, { waitTimeoutMs: 0, retryDelayMs: delay, signal: options.signal })
          const count = (await readdir(tickets)).filter((name) => name.endsWith(".ticket")).length
          await unlink(ticket)
          return { count, release: async () => releaseLock(lockPath, record) }
        } catch (error) {
          if (Date.now() - started >= timeout) throw error
        }
      } else if (Date.now() - started >= timeout) {
        throw new Error("recall-wake lease wait timed out")
      }
      await new Promise<void>((resolve) => setTimeout(resolve, Math.min(delay, Math.max(1, timeout - (Date.now() - started)))))
    }
  } catch (error) {
    await unlink(ticket).catch(() => undefined)
    throw error
  }
}

export async function withRecallWakeLease<T>(locksDirectory: string, fn: (lease: RecallWakeLease) => Promise<T>, options?: RecallWakeLeaseOptions): Promise<T> {
  const lease = await acquireRecallWakeLease(locksDirectory, options)
  try { return await fn(lease) } finally { await lease.release() }
}
