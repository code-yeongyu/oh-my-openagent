import { afterEach, expect, spyOn, test } from "bun:test"

import { startHostHeartbeat } from "./handle-heartbeat"

// #11714: close() called timer.unref() unguarded, so a timer implementation whose unref throws
// (fake timers, a patched global) let the throw escape from teardown as an uncaught exception.
// Every timer in this clock throws on unref, so the drive below covers the schedule, deadline and
// close sites in one pass: an unguarded schedule or close site throws from construction or an
// advance; the deadline site runs in the probe's rejection handler, so it would surface only as
// an unhandled rejection.

function throwingUnrefClock() {
  let now = 0
  const timers = new Map<object, { at: number; callback: () => void }>()
  const install = (callback: () => void, ms: number) => {
    const id = {
      unref() {
        throw new Error("unref exploded")
      },
    }
    timers.set(id, { at: now + ms, callback })
    return id as unknown as ReturnType<typeof setTimeout>
  }
  const timeout = spyOn(globalThis, "setTimeout").mockImplementation(
    ((callback: () => void, ms = 0) => install(callback, ms)) as typeof setTimeout,
  )
  const clearTimeoutSpy = spyOn(globalThis, "clearTimeout").mockImplementation((id) => {
    timers.delete(id as object)
  })
  const date = spyOn(Date, "now").mockImplementation(() => now)
  return {
    async advance(ms: number) {
      // given: drain timers in time order, letting promise reactions settle after each callback
      const end = now + ms
      for (;;) {
        const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
        if (next === undefined) break
        const [id, timer] = next
        now = timer.at
        timers.delete(id)
        timer.callback()
        await new Promise<void>((resolve) => setImmediate(resolve))
      }
      now = end
      await new Promise<void>((resolve) => setImmediate(resolve))
    },
    restore() {
      timeout.mockRestore()
      clearTimeoutSpy.mockRestore()
      date.mockRestore()
    },
  }
}

let clock: ReturnType<typeof throwingUnrefClock> | undefined
afterEach(() => {
  clock?.restore()
  clock = undefined
})

test("a throwing unref never escapes heartbeat teardown", async () => {
  // given: a probe that always fails, so the heartbeat walks running -> unresponsive -> terminal-pending -> close
  clock = throwingUnrefClock()
  let closes = 0
  const heartbeat = startHostHeartbeat({
    taskId: "hb-unref-guard",
    intervalMs: 1000,
    paused: () => false,
    probe: async () => {
      throw new Error("boom")
    },
    onState: () => {},
    onStatus: () => {},
    close: async () => {
      closes++
    },
    onGone: () => {},
  })

  // when: three failed probes arm the unresponsive deadline, which then fires close()
  // (a still-running heartbeat re-arms the 10 s probe deadline after each failure, so the first
  // two advances are 10 s each; only once unresponsive does the retry backoff apply)
  await clock.advance(1000)
  await clock.advance(10_000)
  await clock.advance(10_000)
  await clock.advance(120_000)
  await new Promise<void>((resolve) => setImmediate(resolve))

  // then: teardown completed without any unref throw escaping, and the close port was actually called
  expect(heartbeat.status().state).toBe("terminal-pending")
  expect(closes).toBeGreaterThan(0)
  heartbeat.stop()
})
