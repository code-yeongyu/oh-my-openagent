import type { Clock } from "./api"

export type VirtualClock = Clock & { readonly sleeps: readonly number[]; elapsed(): number }

/** A clock whose sleeps return at once and advance virtual time, recording each requested wait. */
export function virtualClock(start = Date.now()): VirtualClock {
  let now = start
  const sleeps: number[] = []
  return {
    sleeps,
    now: () => now,
    elapsed: () => now - start,
    sleep: async (ms, signal) => {
      if (signal?.aborted) throw signal.reason
      sleeps.push(ms)
      now += Math.max(0, ms)
      await Promise.resolve()
    },
  }
}
