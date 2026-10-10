import type { IdleReclaimerScheduler, IdleReclaimerTimer } from "../port"

export function signal<T>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

export async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("live-parent lifecycle event did not arrive")), 2_000)
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
    advance: (ms: number) => {
      clock.now += ms
      for (const timer of [...timers.values()])
        if (timer.due <= clock.now) {
          timer.due = clock.now + timer.delay
          timer.callback()
        }
    },
  }
}
