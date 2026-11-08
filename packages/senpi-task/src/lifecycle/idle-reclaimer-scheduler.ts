import type { IdleReclaimerScheduler, IdleReclaimerTimer } from "./port"

const MAX_TIMER_DELAY_MS = 2_147_483_647

/** Preserve safe-integer retention without native timers clamping long delays to one millisecond. */
export function createIdleReclaimerScheduler<Timer extends IdleReclaimerTimer>(timers: {
  readonly setTimeout: (callback: () => void, delayMs: number) => Timer
  readonly clearTimeout: (timer: Timer) => void
}): IdleReclaimerScheduler {
  const cancellations = new WeakMap<IdleReclaimerTimer, () => void>()
  return {
    setInterval(callback, delayMs) {
      let remaining = delayMs
      let active = true
      let unreferenced = false
      let current: Timer | undefined
      const interval: IdleReclaimerTimer = { unref: () => { unreferenced = true; current?.unref?.() } }
      const schedule = () => {
        const chunk = Math.min(remaining, MAX_TIMER_DELAY_MS)
        current = timers.setTimeout(() => {
          remaining -= chunk
          if (remaining === 0) {
            remaining = delayMs
            callback()
          }
          if (active) schedule()
        }, chunk)
        if (unreferenced) current.unref?.()
      }
      cancellations.set(interval, () => {
        active = false
        if (current !== undefined) timers.clearTimeout(current)
        cancellations.delete(interval)
      })
      schedule()
      return interval
    },
    clearInterval(interval) { cancellations.get(interval)?.() },
  }
}

export const defaultIdleReclaimerScheduler = createIdleReclaimerScheduler({
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (timer) => clearTimeout(timer),
})
