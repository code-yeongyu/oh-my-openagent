import { spyOn } from "bun:test"

/** Runs timer callbacks in registration order and drains their promise reactions at each boundary. */
export function fakeClock() {
  let now = 0
  const timers = new Map<object, { at: number; interval?: number; callback: () => void }>()
  const install = (callback: () => void, ms: number, interval?: number) => {
    const id = { unref() {} }
    timers.set(id, { at: now + ms, interval, callback })
    return id
  }
  const timeout = spyOn(globalThis, "setTimeout").mockImplementation(
    ((callback: () => void, ms = 0) => install(callback, ms)) as typeof setTimeout,
  )
  const interval = spyOn(globalThis, "setInterval").mockImplementation(
    ((callback: () => void, ms = 0) => install(callback, ms, ms)) as typeof setInterval,
  )
  const clearTimeoutSpy = spyOn(globalThis, "clearTimeout").mockImplementation((id) => { timers.delete(id as object) })
  const clearIntervalSpy = spyOn(globalThis, "clearInterval").mockImplementation((id) => { timers.delete(id as object) })
  const date = spyOn(Date, "now").mockImplementation(() => now)
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
      timeout.mockRestore()
      interval.mockRestore()
      clearTimeoutSpy.mockRestore()
      clearIntervalSpy.mockRestore()
      date.mockRestore()
    },
  }
}
