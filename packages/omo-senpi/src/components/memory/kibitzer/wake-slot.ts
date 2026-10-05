// Machine-wide admission for resident Kibitzer wakes.
//
// Every provider turn of every sidecar on this machine first takes one of N leases from the
// memory-core `recall-wake` domain (N = `memory.recall.max_concurrent_wakes`, default 2). The lease
// is FIFO across sessions and processes, recovers a dead holder only on pid/start-identity proof,
// and is waited for with a bound: a wake that finds every slot held for the whole wait is told
// `busy` and the sidecar simply keeps buffering until the next hook tries again. Nothing here ever
// retries on its own - the caller's hooks are the only clock - and the caller's signal (session
// shutdown) ends a wait at once. Filesystem failures are not hidden behind `busy`: they propagate so
// the sidecar can count them as a start failure and back off.

import { RecallWakeBusyError, acquireRecallWakeLease } from "@oh-my-opencode/memory-core"

/** Longest one wake waits for a lease before it is reported busy. */
export const KIBITZER_WAKE_SLOT_WAIT_MS = 15_000
/** Pause between queue polls while waiting: a delay, never a spin. */
export const KIBITZER_WAKE_SLOT_POLL_MS = 200

export interface KibitzerWakeLease {
  /** 1-based machine slot this wake occupies. */
  readonly slot: number
  /** Hands the slot back; false when the lease was already released (or reclaimed from under us). */
  release(): Promise<boolean>
}

export type KibitzerWakeAdmission =
  | { readonly status: "acquired"; readonly lease: KibitzerWakeLease; readonly waitedMs: number }
  /** Every slot stayed with a live owner for the whole bounded wait. */
  | { readonly status: "busy"; readonly waitedMs: number }
  /** The caller's signal fired while waiting. */
  | { readonly status: "aborted" }

export interface KibitzerWakeSlot {
  readonly maxConcurrent: number
  /** Resolves with the admission verdict; rejects only on a filesystem failure of the lock domain. */
  acquire(signal?: AbortSignal): Promise<KibitzerWakeAdmission>
}

export interface KibitzerWakeSlotOptions {
  /** The bound identity's `runtime/locks` directory: the domain is machine-wide because every process shares it. */
  readonly locksDirectory: string
  /** `memory.recall.max_concurrent_wakes`. */
  readonly maxConcurrent: number
  readonly waitTimeoutMs?: number
  readonly pollMs?: number
  readonly now?: () => number
}

export function createKibitzerWakeSlot(options: KibitzerWakeSlotOptions): KibitzerWakeSlot {
  const { locksDirectory, maxConcurrent } = options
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
    throw new Error(`memory.recall.max_concurrent_wakes must be a positive integer, got ${maxConcurrent}`)
  }
  const waitTimeoutMs = options.waitTimeoutMs ?? KIBITZER_WAKE_SLOT_WAIT_MS
  const retryDelayMs = options.pollMs ?? KIBITZER_WAKE_SLOT_POLL_MS
  const now = options.now ?? Date.now
  return {
    maxConcurrent,
    async acquire(signal) {
      const started = now()
      try {
        const lease = await acquireRecallWakeLease(locksDirectory, {
          maxConcurrent,
          waitTimeoutMs,
          retryDelayMs,
          ...(signal === undefined ? {} : { signal }),
        })
        return { status: "acquired", lease: { slot: lease.slot, release: lease.release }, waitedMs: Math.max(0, now() - started) }
      } catch (error) {
        if (error instanceof RecallWakeBusyError) return { status: "busy", waitedMs: Math.max(0, now() - started) }
        if (signal?.aborted === true) return { status: "aborted" }
        throw error
      }
    },
  }
}
