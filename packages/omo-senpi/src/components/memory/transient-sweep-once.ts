// One transient reclaim per memory root per engine process, off the session-open path.
//
// The extension factory runs for every session an engine opens, so a sweep started from
// registration repeated the same walk (up to 512 entries per run folder) on every open, on the
// open's own event loop. What it reclaims is at least a day old, so once per process is enough:
// the first registration claims the memory root and the sweep starts after an unref'd delay.
//
// Cleanup guarantee: a run that crashed is still reclaimed on the next process start. A session
// that shuts down before its deferred sweep started hands the claim back, so a later open in the
// same process sweeps instead. The claim lives on `globalThis` under a registry symbol, so every
// copy of this module loaded into one process shares it.

const CLAIMS = Symbol.for("omo.memory.transient-sweep.claims")

export const TRANSIENT_SWEEP_DEFER_MS = 1_000

export interface TransientSweepSchedule {
  readonly cancel: () => void
}

type ClaimHolder = { [CLAIMS]?: Set<string> }

function claimedRoots(): Set<string> {
  const holder = globalThis as ClaimHolder
  holder[CLAIMS] ??= new Set<string>()
  return holder[CLAIMS]
}

export function scheduleTransientSweepOnce(input: {
  readonly memoryRoot: string
  readonly start: () => void
  readonly deferMs?: number
}): TransientSweepSchedule | undefined {
  const claims = claimedRoots()
  if (claims.has(input.memoryRoot)) return undefined
  claims.add(input.memoryRoot)
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
      claims.delete(input.memoryRoot)
    },
  }
}
