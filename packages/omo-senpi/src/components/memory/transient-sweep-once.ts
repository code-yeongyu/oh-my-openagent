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
// that shuts down before its deferred sweep started hands the claim back, so a later open in the
// same process sweeps instead. The claim lives on `globalThis` under a registry symbol, so every
// copy of this module loaded into one process shares it.

import { TRANSIENT_RUN_MAX_AGE_MS } from "./transient-sweep"

const CLAIMS = Symbol.for("omo.memory.transient-sweep.claims")

const TRANSIENT_SWEEP_DEFER_MS = 1_000

export interface TransientSweepSchedule {
  readonly cancel: () => void
}

/** Memory root -> when it was claimed (ms). */
type ClaimHolder = { [CLAIMS]?: Map<string, number> }

function claimedRoots(): Map<string, number> {
  const holder = globalThis as ClaimHolder
  holder[CLAIMS] ??= new Map<string, number>()
  return holder[CLAIMS]
}

export function scheduleTransientSweepOnce(input: {
  readonly memoryRoot: string
  readonly start: () => void
  readonly deferMs?: number
  readonly now?: () => number
}): TransientSweepSchedule | undefined {
  const claims = claimedRoots()
  const claimedAt = (input.now ?? Date.now)()
  const previous = claims.get(input.memoryRoot)
  if (previous !== undefined && claimedAt - previous < TRANSIENT_RUN_MAX_AGE_MS) return undefined
  claims.set(input.memoryRoot, claimedAt)
  let started = false
  const timer = setTimeout(() => {
    started = true
    input.start()
  }, input.deferMs ?? TRANSIENT_SWEEP_DEFER_MS)
  timer.unref?.()
  return {
    cancel: () => {
      if (started) return
      clearTimeout(timer)
      if (claims.get(input.memoryRoot) === claimedAt) claims.delete(input.memoryRoot)
    },
  }
}
