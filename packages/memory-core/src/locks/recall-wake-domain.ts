import {
  acquireCountingLease,
  countingLeaseLockPath,
  countingLeaseTicketDirectory,
  type CountingLease,
  type CountingLeaseOptions,
} from "./counting-lease"

export { setCountingLeaseTicketFsForTests as setRecallWakeTicketFsForTests } from "./counting-lease"
export type { CountingLeaseTicketFs as RecallWakeTicketFs } from "./counting-lease"
export type RecallWakeLease = Pick<CountingLease, "slot" | "release">
export type RecallWakeLeaseOptions = CountingLeaseOptions
export const RECALL_WAKE_DEFAULT_SLOTS = 2

export class RecallWakeBusyError extends Error {
  readonly retriable = true
  constructor(readonly waitedMs: number, readonly maxConcurrent: number) {
    super(`recall-wake: all ${maxConcurrent} slot(s) busy after ${waitedMs}ms`)
    this.name = "RecallWakeBusyError"
  }
}

export function recallWakeLockPath(locksDirectory: string, slot: number): string {
  return countingLeaseLockPath(locksDirectory, "recall-wake", slot)
}

export function recallWakeTicketDirectory(locksDirectory: string): string {
  return countingLeaseTicketDirectory(locksDirectory, "recall-wake")
}

export function acquireRecallWakeLease(locksDirectory: string, options: RecallWakeLeaseOptions = {}): Promise<RecallWakeLease> {
  return acquireCountingLease(locksDirectory, {
    purpose: "recall-wake",
    defaultSlots: RECALL_WAKE_DEFAULT_SLOTS,
    waitTimeoutMs: 0,
    busyError: (waited, count) => new RecallWakeBusyError(waited, count),
  }, options)
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
