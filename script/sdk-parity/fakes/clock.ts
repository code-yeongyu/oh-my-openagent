import type { WaitClock } from "../../../packages/omo-senpi/src/components/call-budget/call-deadline"

// The scenario's virtual clock (design 4.4): it stands still until a fake port call the scenario states as taking time
// (an expectation's `takes_ms`) advances it, and every timer whose time has come then fires, in time order, before that
// call answers. Nothing sleeps and nothing polls. A timer for no time at all fires at once (an abort at 0 ms comes before
// the call). The root's waits read it (the `waitClock` port), the runner's abort is set on it, and the fakes' `now` is it.

export type VirtualClock = WaitClock & { readonly advance: (ms: number) => void }

export function virtualClock(start: number): VirtualClock {
  let now = start
  const timers = new Set<{ readonly at: number; readonly fire: () => void }>()
  return {
    now: () => now,
    after: (ms, fire) => {
      if (ms <= 0) {
        fire()
        return () => undefined
      }
      const timer = { at: now + ms, fire }
      timers.add(timer)
      return () => timers.delete(timer)
    },
    advance: (ms) => {
      now += ms
      const due = [...timers].filter((timer) => timer.at <= now).toSorted((a, b) => a.at - b.at)
      for (const timer of due) {
        timers.delete(timer)
        timer.fire()
      }
    },
  }
}
