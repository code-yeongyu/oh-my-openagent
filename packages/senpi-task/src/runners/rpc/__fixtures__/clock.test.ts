import { afterEach, expect, test } from "bun:test"
import { fakeClock } from "./clock"

let clock: ReturnType<typeof fakeClock> | undefined
afterEach(() => clock?.restore())

test("#given leaked timeout and interval #when checking pending timers #then the failure identifies both delays and creation frames", () => {
  clock = fakeClock()
  const timeout = setTimeout(() => {}, 37)
  const interval = setInterval(() => {}, 53)
  expect(clock.pending()).toBe(2)
  expect(() => clock?.assertNoPendingTimers()).toThrow(/delay=37ms/)
  expect(() => clock?.assertNoPendingTimers()).toThrow(/delay=53ms/)
  expect(() => clock?.assertNoPendingTimers()).toThrow(/clock\.test\.ts:\d+:\d+/)
  clearTimeout(timeout)
  clearInterval(interval)
  clock.assertNoPendingTimers()
})

// One bun process runs every test file, so work an earlier test left running can arm a timer while a later test's
// clock is installed. Counting it made that test's `pending()` assertion depend on host load (#11446).
test("#given work another test left running #when it arms a timer under this clock #then it keeps the real clock and is not counted", async () => {
  let resume!: () => void
  const leftover = new Promise<void>((resolve) => { resume = resolve })
    .then(() => new Promise<number>((resolve) => setTimeout(() => resolve(Date.now()), 1)))
  clock = fakeClock()
  setTimeout(() => {}, 1)
  resume()
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(clock.pending()).toBe(1)
  expect(await leftover).toBeGreaterThan(clock.now())
  await clock.advance(1)
  expect(clock.pending()).toBe(0)
})

// The clock only fakes work started after it, so it must be created before the objects under test. A timer
// armed from an async context created before this call keeps the real clock and is recorded as untracked
// instead of counted; assertNoUntrackedTimers() makes that ordering failure loud.
test("#given the clock is created before the objects under test #when they arm timers #then every timer is tracked and none is untracked", async () => {
  clock = fakeClock()
  let fired = false
  setTimeout(() => { fired = true }, 25)
  expect(clock.pending()).toBe(1)
  clock.assertNoUntrackedTimers()
  await clock.advance(25)
  expect(fired).toBe(true)
  expect(clock.pending()).toBe(0)
})

test("#given a timer armed from an async context created before the clock #when the clock checks for untracked timers #then it names the untracked timer", async () => {
  let resume!: () => void
  const gate = new Promise<void>((resolve) => { resume = resolve })
  const armAfterClock = gate.then(() => { setTimeout(() => {}, 25) })
  clock = fakeClock()
  resume()
  await armAfterClock
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(() => clock?.assertNoUntrackedTimers()).toThrow(/delay=25ms/)
  expect(clock.pending()).toBe(0)
})
