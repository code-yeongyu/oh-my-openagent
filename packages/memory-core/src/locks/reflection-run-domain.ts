import { acquireCountingLease } from "./counting-lease"

/** Reflection runs queue without a timeout; only execution consumes the run budget. */
export function acquireReflectionRunLease(locksDirectory: string, maxConcurrent = 1, signal?: AbortSignal) {
  return acquireCountingLease(locksDirectory, {
    purpose: "reflection-run",
    defaultSlots: 1,
    waitTimeoutMs: Number.POSITIVE_INFINITY,
    busyError: () => new Error("unbounded reflection queue exhausted"),
  }, { maxConcurrent, signal })
}
