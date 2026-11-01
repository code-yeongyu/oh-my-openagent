import { withinTestBudget } from "../../../../../test-support/test-deadline"
import type { IdleReclaimerScheduler, IdleReclaimerTimer } from "../port"

export function signal<T>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

export function bounded<T>(promise: Promise<T>, phase = "awaited phase"): Promise<T> {
  return withinTestBudget(promise, `live-parent lifecycle event did not arrive: ${phase}`)
}

export function recoveryClock() {
  const clock = { now: Date.parse("2026-10-09T00:00:00Z") }
  const timers = new Map<IdleReclaimerTimer, { callback: () => void; delay: number; due: number }>()
  const scheduler: IdleReclaimerScheduler = {
    setInterval(callback, delay) {
      const timer = { unref: () => undefined }
      timers.set(timer, { callback, delay, due: clock.now + delay })
      return timer
    },
    clearInterval: (timer) => {
      timers.delete(timer)
    },
  }
  return {
    clock,
    timers,
    scheduler,
    advance: (ms: number, runTimers = true) => {
      clock.now += ms
      for (const timer of [...timers.values()])
        if (runTimers && timer.due <= clock.now) {
          timer.due = clock.now + timer.delay
          timer.callback()
        }
    },
  }
}
