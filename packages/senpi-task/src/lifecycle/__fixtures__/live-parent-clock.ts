import { remainingTestTime } from "../../../../../test-support/test-deadline"
import type { IdleReclaimerScheduler, IdleReclaimerTimer } from "../port"

export function signal<T>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

/**
 * A circuit breaker, never a pacing step: it shares the test's whole remaining budget, so real I/O on a slow
 * runner (and the production abort grace) can finish; a fixed per-step bound raced them (#11257).
 */
export async function bounded<T>(promise: Promise<T>, phase = "awaited phase"): Promise<T> {
  const remainingMs = remainingTestTime()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(
          `live-parent lifecycle event did not arrive: ${phase} (remaining test budget ${Math.round(remainingMs)} ms)`,
        )), remainingMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
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
