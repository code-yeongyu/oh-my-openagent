import { expect, spyOn } from "bun:test"
import { AsyncLocalStorage } from "node:async_hooks"

/**
 * Drive this test's timers, leaving callbacks from pre-existing async work on the real clock.
 * Runs timer callbacks in registration order and drains their promise reactions at each boundary.
 * Only work the calling test starts after this call is faked, so create the clock before the objects under test.
 * One bun process runs every test file: a timer armed by work an earlier test left running keeps the real clock and
 * `pending()` never counts it (#11446).
 */
export function fakeClock() {
  const scope = new AsyncLocalStorage<boolean>()
  scope.enterWith(true)
  const realTimeout = globalThis.setTimeout
  const realInterval = globalThis.setInterval
  const realClearTimeout = globalThis.clearTimeout
  const realClearInterval = globalThis.clearInterval
  const realNow = Date.now
  let now = 0
  const timers = new Map<
    object,
    { at: number; delay: number; stack: string; interval?: number; callback: () => void }
  >()
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
  const timeout = spyOn(globalThis, "setTimeout").mockImplementation(((
    callback: () => void,
    ms = 0,
    ...args: unknown[]
  ) =>
    scope.getStore()
      ? install(() => Reflect.apply(callback, globalThis, args), ms)
      : realTimeout(callback, ms, ...args)) as typeof setTimeout)
  const interval = spyOn(globalThis, "setInterval").mockImplementation(((
    callback: () => void,
    ms = 0,
    ...args: unknown[]
  ) =>
    scope.getStore()
      ? install(() => Reflect.apply(callback, globalThis, args), ms, ms)
      : realInterval(callback, ms, ...args)) as typeof setInterval)
  const clearTimeoutSpy = spyOn(globalThis, "clearTimeout").mockImplementation((id) => clear(id, realClearTimeout))
  const clearIntervalSpy = spyOn(globalThis, "clearInterval").mockImplementation((id) => clear(id, realClearInterval))
  const date = spyOn(Date, "now").mockImplementation(() => (scope.getStore() ? now : realNow()))
  return {
    now: () => now,
    pending: () => timers.size,
    assertNoPendingTimers() {
      const details = [...timers.values()]
        .map(
          (timer) => `${timer.interval === undefined ? "timeout" : "interval"} delay=${timer.delay}ms\n${timer.stack}`,
        )
        .join("\n")
      expect(timers.size, details).toBe(0)
    },
    async advance(ms: number) {
      const end = now + ms
      let fired = 0
      for (;;) {
        const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
        if (next === undefined) break
        if (++fired > 10_000)
          throw new Error("fake clock fired more than 10000 timers in one advance: a timer keeps rescheduling itself")
        const [id, timer] = next
        now = timer.at
        if (timer.interval === undefined) timers.delete(id)
        else timer.at += timer.interval
        scope.run(true, timer.callback)
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
