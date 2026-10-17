import type { LockRecord } from "./lock-record"
import { readOwner } from "./lock-owner"
import { publishExclusive } from "./publish"
import { delay, lockRetryDelayMs } from "./retry-delay"
import { recoverStaleOwner } from "./stale-owner"

export type AcquireLockOptions = {
  readonly waitTimeoutMs?: number
  readonly retryDelayMs?: number
  readonly incompleteLockGraceMs?: number
  readonly now?: () => number
  readonly signal?: AbortSignal
}

const INCOMPLETE_LOCK_GRACE_MS = 5_000

export class LockContentionError extends Error {
  readonly retriable = true

  constructor(
    readonly lockPath: string,
    readonly owner: LockRecord | null,
  ) {
    super(`Lock is held: ${lockPath}`)
    this.name = "LockContentionError"
  }
}

/** {@link acquireLock} without the directory hygiene: the dead-owner sweep reclaims through this. */
export async function acquireWithoutDirectorySweep(
  lockPath: string,
  record: LockRecord,
  options: AcquireLockOptions = {},
): Promise<void> {
  const waitTimeoutMs = options.waitTimeoutMs ?? 0
  const retryDelayMs = options.retryDelayMs ?? 25
  const incompleteLockGraceMs = options.incompleteLockGraceMs ?? INCOMPLETE_LOCK_GRACE_MS
  const now = options.now ?? Date.now
  if (waitTimeoutMs < 0 || retryDelayMs <= 0 || incompleteLockGraceMs < 0) throw new Error("lock wait options must be positive")
  const deadline = now() + waitTimeoutMs

  for (let attempt = 0; ; attempt += 1) {
    options.signal?.throwIfAborted()
    // Read before publishing. `publishExclusive` creates a candidate file, writes it, FSYNCS it,
    // hard-links it and unlinks it - six filesystem operations, one of them durable - and while
    // another process visibly holds the lock every one of them is doomed. A waiter that retried
    // the publish instead of the read produced that whole cycle on every tick of its retry delay:
    // at the 5ms delay the two-process writer test uses, ~200 fsynced create/unlink cycles per
    // second, aimed at the same volume the lock holder was committing to. That is the load that
    // starved the Windows shard-1 writer test out of its 30s budget (#8323); the read costs one
    // open+read and cannot block the holder.
    let owner = await readOwner(lockPath)
    if (owner === null) {
      if (await publishExclusive(lockPath, record)) return
      options.signal?.throwIfAborted()
      // Lost the publish race: re-read so the contention error and the dead-owner check still see
      // the holder that won, exactly as the read-after-failed-publish order always did.
      owner = await readOwner(lockPath)
      if (owner === null) continue
    }
    if (await recoverStaleOwner(lockPath, owner, record, now(), incompleteLockGraceMs)) continue
    options.signal?.throwIfAborted()
    if (now() >= deadline) throw new LockContentionError(lockPath, owner.record)
    await delay(Math.min(lockRetryDelayMs(attempt, retryDelayMs), Math.max(1, deadline - now())), options.signal)
  }
}
