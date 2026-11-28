// One transient reclaim per memory root per engine process, off the session-open path.
//
// The extension factory runs for every session an engine opens, so a sweep started from
// registration repeated the same walk (up to 512 entries per run folder) on every open, on the
// open's own event loop. What it reclaims is at least a day old (TRANSIENT_RUN_MAX_AGE_MS), so one
// sweep per that interval is enough: the first registration claims the memory root and the sweep
// starts after an unref'd delay. A claim expires after TRANSIENT_RUN_MAX_AGE_MS, so a long-lived
// engine (the desktop's or a daemon host's) sweeps again on the first open after it, instead of
// only at process start.
//
// Cleanup guarantee: a run that crashed is still reclaimed on the next process start. A session
// that shuts down before its deferred sweep started hands the claim back when it is the last
// registration on the root; while any other registration is still open the claim and its deferred
// sweep survive (#12900). The claim lives on `globalThis` under a registry symbol, so every
// copy of this module loaded into one process shares it.

import { realpathSync } from "node:fs"
import { TRANSIENT_RUN_MAX_AGE_MS } from "./transient-sweep"

const CLAIMS = Symbol.for("omo.memory.transient-sweep.claims")

const TRANSIENT_SWEEP_DEFER_MS = 1_000

export interface TransientSweepSchedule {
  readonly cancel: () => void
}

interface SweepClaim {
  readonly claimedAt: number
  /** Registrations on this root still holding it open; the last one out releases the claim (#12900). */
  readonly holders: Set<object>
  readonly timer: ReturnType<typeof setTimeout>
  started: boolean
}

/** Memory root -> its live claim, keyed by the root's real path. */
type ClaimHolder = { [CLAIMS]?: Map<string, SweepClaim> }

function claimedRoots(): Map<string, SweepClaim> {
  const holder = globalThis as ClaimHolder
  holder[CLAIMS] ??= new Map<string, SweepClaim>()
  return holder[CLAIMS]
}

// One memory root reached through a symlink or a trailing separator is still one root; keying on
// the raw spelling swept the same root once per spelling (#12900).
function sweepKey(memoryRoot: string): string {
  try {
    return realpathSync(memoryRoot)
  } catch {
    return memoryRoot
  }
}

export function scheduleTransientSweepOnce(input: {
  readonly memoryRoot: string
  readonly start: () => void
  readonly deferMs?: number
  readonly now?: () => number
}): TransientSweepSchedule | undefined {
  const claims = claimedRoots()
  const claimedAt = (input.now ?? Date.now)()
  const key = sweepKey(input.memoryRoot)
  const existing = claims.get(key)
  if (existing !== undefined && claimedAt - existing.claimedAt < TRANSIENT_RUN_MAX_AGE_MS) {
    // Later registrations hold the claim open: the claimer's shutdown alone must not cancel the
    // deferred sweep while another session on this root is still open (#12900).
    existing.holders.add({})
    return undefined
  }
  if (existing !== undefined && !existing.started) clearTimeout(existing.timer)
  const holder = {}
  const claim: SweepClaim = {
    claimedAt,
    holders: new Set([holder]),
    timer: setTimeout(() => {
      claim.started = true
      input.start()
    }, input.deferMs ?? TRANSIENT_SWEEP_DEFER_MS),
    started: false,
  }
  claim.timer.unref?.()
  claims.set(key, claim)
  return {
    cancel: () => {
      claim.holders.delete(holder)
      // Another registration on this root is still open: the claim and its sweep stay armed.
      if (claim.holders.size > 0) return
      if (!claim.started) clearTimeout(claim.timer)
      if (claims.get(key) === claim) claims.delete(key)
    },
  }
}
