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
 * Awaits a lifecycle event with a named failure. The deadline is the test's remaining budget, not a
 * fresh stopwatch: a fixed 2 s bound fired on hosted Windows whenever the runner stalled although the
 * event still arrived (#10814).
 */
/** Fixed bound for teardown awaits in finally blocks: the test budget may already be spent there. */
export const LIVE_PARENT_TEARDOWN_BOUND_MS = 5_000

export async function bounded<T>(promise: Promise<T>, fixedMs?: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(fixedMs === undefined
            ? "live-parent lifecycle event did not arrive within the test budget"
            : `live-parent teardown did not settle within ${fixedMs} ms`)),
          fixedMs ?? remainingTestTime(),
        )
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
