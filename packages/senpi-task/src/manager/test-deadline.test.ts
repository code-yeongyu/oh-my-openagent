import { afterAll, afterEach, expect, mock, spyOn, test } from "bun:test"
import {
  awaitWithinTestBudget,
  DEFAULT_TEST_TIMEOUT_MS,
  remainingTestTime,
  resetTestDeadline,
  testBudgetSignal,
  useTestTimeout,
} from "../../../../test-support/test-deadline"

const originalNow = performance.now
let now = 0
// The root preload restores Bun spies after each test; keep this clock until file teardown.
performance.now = () => now
afterAll(() => {
  performance.now = originalNow
  resetTestDeadline()
})
// Package-local runs do not load the root preload that restores spies, so this file restores its own.
afterEach(() => mock.restore())
const realTimers = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout }

test("#given an earlier test #when its clock exhausts the launch budget #then no time remains", () => {
  now += DEFAULT_TEST_TIMEOUT_MS * 2
  expect(remainingTestTime()).toBe(0)
})

test("#given the next test #when its preload resets the stopwatch #then it has its own launch budget", () => {
  expect(remainingTestTime()).toBe(DEFAULT_TEST_TIMEOUT_MS * 0.9)
  expect(remainingTestTime(15_000)).toBe(13_500)
})

// One fake clock for both wait primitives: a timer or timeout signal is due at `now + delay`, and `elapse`
// fires everything that came due, the way a stalled runner delivers its overdue timers at once.
function fakeTimers() {
  const pending: { readonly due: number; readonly fire: () => void }[] = []
  const armed: number[] = []
  spyOn(globalThis, "setTimeout").mockImplementation(((fire: () => void, delay?: number) => {
    armed.push(delay ?? 0)
    pending.push({ due: now + (delay ?? 0), fire })
    return pending.length as unknown as ReturnType<typeof setTimeout>
  }) as unknown as typeof setTimeout)
  spyOn(globalThis, "clearTimeout").mockImplementation(() => undefined)
  return {
    armed,
    elapse(ms: number): void {
      now += ms
      const due = pending.filter((timer) => timer.due <= now)
      pending.splice(0, pending.length, ...pending.filter((timer) => timer.due > now))
      for (const timer of due) timer.fire()
    },
  }
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const settle = <T,>(waited: Promise<T>) =>
  waited.then(
    (value) => ({ status: "resolved" as const, value }),
    (error: unknown) => ({ status: "rejected" as const, name: error instanceof Error || error instanceof DOMException ? error.name : typeof error }),
  )

const waitPrimitives = [
  { primitive: "awaitWithinTestBudget", wait: <T,>(event: Promise<T>) => awaitWithinTestBudget(event, "the awaited event"), failure: "Error" },
  {
    primitive: "testBudgetSignal",
    wait: <T,>(event: Promise<T>) => {
      const signal = testBudgetSignal()
      return new Promise<T>((resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true })
        void event.then(resolve)
      })
    },
    failure: "TimeoutError",
  },
] as const

const declaredBudgets = waitPrimitives.flatMap((row) => [
  { ...row, budget: "the suite default", declared: undefined, timeoutMs: DEFAULT_TEST_TIMEOUT_MS },
  { ...row, budget: "a shorter declared 15 s timeout", declared: 15_000, timeoutMs: 15_000 },
])

test.each(declaredBudgets)("#given $budget with part of it spent #when $primitive arms its deadline #then it gets exactly the remaining share of that budget", ({ wait, declared, timeoutMs }) => {
  // given
  const timers = fakeTimers()
  if (declared !== undefined) useTestTimeout(declared)
  now += 5_000

  // when
  void wait(new Promise<never>(() => undefined)).catch(() => undefined)

  // then
  expect(timers.armed).toEqual([timeoutMs * 0.9 - 5_000])
})

test.each(waitPrimitives)("#given a stalled runner #when the awaited event arrives after the stall #then $primitive resolves with it", async ({ wait }) => {
  // given
  const timers = fakeTimers()
  const event = deferred<string>()
  const waited = settle(wait(event.promise))

  // when
  timers.elapse(4_000)
  event.resolve("arrived")

  // then
  expect(await waited).toEqual({ status: "resolved", value: "arrived" })
})

test.each(waitPrimitives)("#given an event that never comes #when the remaining budget runs out #then $primitive fails on its own before the test times out", async ({ wait, failure }) => {
  // given
  const timers = fakeTimers()
  const waited = settle(wait(new Promise<never>(() => undefined)))

  // when
  timers.elapse(DEFAULT_TEST_TIMEOUT_MS * 0.9)

  // then
  expect(await waited).toEqual({ status: "rejected", name: failure })
})

test("#given the rows above replaced the timers #when a later test runs #then it sees the real setTimeout and clearTimeout again", () => {
  // then
  expect(globalThis.setTimeout).toBe(realTimers.setTimeout)
  expect(globalThis.clearTimeout).toBe(realTimers.clearTimeout)
})
