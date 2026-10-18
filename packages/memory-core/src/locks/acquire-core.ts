import type { LockRecord } from "./lock-record"
import { readOwner } from "./lock-owner"
import { forgetProvenDeadTakeover } from "./proven-dead-takeovers"
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
): Promise<AcquireOutcome> {
  const waitTimeoutMs = options.waitTimeoutMs ?? 0
  const retryDelayMs = options.retryDelayMs ?? 25
  const incompleteLockGraceMs = options.incompleteLockGraceMs ?? INCOMPLETE_LOCK_GRACE_MS
  const now = options.now ?? Date.now
  if (waitTimeoutMs < 0 || retryDelayMs <= 0 || incompleteLockGraceMs < 0) throw new Error("lock wait options must be positive")
  const deadline = now() + waitTimeoutMs

  try {
    return await acquireLoop(lockPath, record, options, { retryDelayMs, incompleteLockGraceMs, now, deadline })
  } catch (error) {
    // A takeover this contender proved but never turned into a held lock authorizes nothing.
    forgetProvenDeadTakeover(lockPath, record.nonce)
    throw error
  }
}

/** `sawOtherOwner`: some owner other than this record held the lock at a read during this acquisition. */
export type AcquireOutcome = { readonly sawOtherOwner: boolean }

type LoopTiming = {
  readonly retryDelayMs: number
  readonly incompleteLockGraceMs: number
  readonly now: () => number
  readonly deadline: number
}

function forfeitDeadOwnerProof(lockPath: string, record: LockRecord, recoveredDeadOwner: boolean): false {
  if (recoveredDeadOwner) forgetProvenDeadTakeover(lockPath, record.nonce)
  return false
}

async function acquireLoop(lockPath: string, record: LockRecord, options: AcquireLockOptions, timing: LoopTiming): Promise<AcquireOutcome> {
  const { retryDelayMs, incompleteLockGraceMs, now, deadline } = timing
  let sawOtherOwner = false
  let recoveredDeadOwner = false
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
      if (await publishExclusive(lockPath, record)) return { sawOtherOwner }
      options.signal?.throwIfAborted()
      // Lost the publish race: another owner held the lock at that instant, even if it has already
      // released by the re-read below, so the dead-owner proof is forfeited here (omo #10199 r8).
      sawOtherOwner = true
      recoveredDeadOwner = forfeitDeadOwnerProof(lockPath, record, recoveredDeadOwner)
      // Re-read so the contention error and the dead-owner check still see the holder that won,
      // exactly as the read-after-failed-publish order always did.
      owner = await readOwner(lockPath)
      if (owner === null) continue
    }
    sawOtherOwner = true
    // A live owner that slipped in after this contender reclaimed the dead one is the dead owner's
    // successor; this acquisition succeeds it and must not keep the dead-owner proof (omo #10199 r5).
    recoveredDeadOwner = forfeitDeadOwnerProof(lockPath, record, recoveredDeadOwner)
    if (await recoverStaleOwner(lockPath, owner, record, now(), incompleteLockGraceMs)) {
      recoveredDeadOwner = true
      continue
    }
    options.signal?.throwIfAborted()
    if (now() >= deadline) throw new LockContentionError(lockPath, owner.record)
    await delay(Math.min(lockRetryDelayMs(attempt, retryDelayMs), Math.max(1, deadline - now())), options.signal)
  }
}
