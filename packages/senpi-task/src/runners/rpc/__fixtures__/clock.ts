import { spyOn } from "bun:test"
import { AsyncLocalStorage } from "node:async_hooks"

/** Drive this test's timers, leaving callbacks from pre-existing async work on the real clock. */
export function fakeClock() {
  const scope = new AsyncLocalStorage<boolean>()
  scope.enterWith(true)
  const realTimeout = globalThis.setTimeout
  const realInterval = globalThis.setInterval
  const realClearTimeout = globalThis.clearTimeout
  const realClearInterval = globalThis.clearInterval
  const realNow = Date.now
  let now = 0
  const timers = new Map<object, { at: number; interval?: number; callback: () => void }>()
  const install = (callback: () => void, ms: number, interval?: number) => {
    const id = { unref() {} }
    timers.set(id, { at: now + ms, interval, callback })
    return id
  }
  const timeout = spyOn(globalThis, "setTimeout").mockImplementation(
    ((callback: () => void, ms = 0, ...args: unknown[]) => scope.getStore()
      ? install(() => Reflect.apply(callback, globalThis, args), ms)
      : realTimeout(callback, ms, ...args)) as typeof setTimeout,
  )
  const interval = spyOn(globalThis, "setInterval").mockImplementation(
    ((callback: () => void, ms = 0, ...args: unknown[]) => scope.getStore()
      ? install(() => Reflect.apply(callback, globalThis, args), ms, ms)
      : realInterval(callback, ms, ...args)) as typeof setInterval,
  )
  const clearTimeoutSpy = spyOn(globalThis, "clearTimeout").mockImplementation((id) => {
    if (!timers.delete(id as object)) Reflect.apply(realClearTimeout, globalThis, [id])
  })
  const clearIntervalSpy = spyOn(globalThis, "clearInterval").mockImplementation((id) => {
    if (!timers.delete(id as object)) Reflect.apply(realClearInterval, globalThis, [id])
  })
  const date = spyOn(Date, "now").mockImplementation(() => scope.getStore() ? now : realNow())
  return {
    now: () => now,
    pending: () => timers.size,
    async advance(ms: number) {
      const end = now + ms
      for (;;) {
        const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
        if (next === undefined) break
        const [id, timer] = next
        now = timer.at
        if (timer.interval === undefined) timers.delete(id)
        else timer.at += timer.interval
        timer.callback()
        await new Promise<void>((resolve) => setImmediate(resolve))
      }
      now = end
      await new Promise<void>((resolve) => setImmediate(resolve))
    },
    restore() {
      scope.disable()
      timeout.mockRestore()
      interval.mockRestore()
      clearTimeoutSpy.mockRestore()
      clearIntervalSpy.mockRestore()
      date.mockRestore()
    },
  }
}
