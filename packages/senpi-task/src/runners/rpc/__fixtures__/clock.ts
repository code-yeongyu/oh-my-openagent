import { expect, spyOn } from "bun:test"
import { AsyncLocalStorage } from "node:async_hooks"

/**
 * Runs timer callbacks in registration order and drains their promise reactions at each boundary.
 * Only work the calling test starts after this call is faked, so create the clock before the objects under test.
 * One bun process runs every test file: a timer armed by work an earlier test left running keeps the real clock and
 * `pending()` never counts it (#11446).
 */
export function fakeClock() {
  const real = { setTimeout, setInterval, clearTimeout, clearInterval, now: Date.now }
  const owner = new AsyncLocalStorage<true>()
  owner.enterWith(true)
  const owned = () => owner.getStore() === true
  let now = 0
  const timers = new Map<object, { at: number; delay: number; stack: string; interval?: number; callback: () => void }>()
  const fakeIds = new WeakSet<object>()
  const install = (callback: () => void, ms: number, interval?: number) => {
    const id = { unref() {} }
    fakeIds.add(id)
    const stack = (new Error().stack ?? "").split("\n").slice(1, 9).join("\n")
    timers.set(id, { at: now + ms, delay: ms, stack, interval, callback })
    return id
  }
  const clear = (id: unknown, clearReal: (id: never) => void) => {
    if (typeof id === "object" && id !== null && fakeIds.has(id)) timers.delete(id)
    else Reflect.apply(clearReal, globalThis, [id])
  }
  const timeout = spyOn(globalThis, "setTimeout").mockImplementation(
    ((callback: () => void, ms = 0, ...args: unknown[]) =>
      owned() ? install(callback, ms) : Reflect.apply(real.setTimeout, globalThis, [callback, ms, ...args])) as typeof setTimeout,
  )
  const interval = spyOn(globalThis, "setInterval").mockImplementation(
    ((callback: () => void, ms = 0, ...args: unknown[]) =>
      owned() ? install(callback, ms, ms) : Reflect.apply(real.setInterval, globalThis, [callback, ms, ...args])) as typeof setInterval,
  )
  const clearTimeoutSpy = spyOn(globalThis, "clearTimeout").mockImplementation((id) => clear(id, real.clearTimeout))
  const clearIntervalSpy = spyOn(globalThis, "clearInterval").mockImplementation((id) => clear(id, real.clearInterval))
  const date = spyOn(Date, "now").mockImplementation(() => (owned() ? now : Reflect.apply(real.now, Date, [])))
  return {
    now: () => now,
    pending: () => timers.size,
    assertNoPendingTimers() {
      const details = [...timers.values()].map((timer) =>
        `${timer.interval === undefined ? "timeout" : "interval"} delay=${timer.delay}ms\n${timer.stack}`,
      ).join("\n")
      expect(timers.size, details).toBe(0)
    },
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
      timeout.mockRestore()
      interval.mockRestore()
      clearTimeoutSpy.mockRestore()
      clearIntervalSpy.mockRestore()
      date.mockRestore()
      owner.disable()
    },
  }
}
