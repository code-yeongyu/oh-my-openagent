import { afterAll, afterEach, expect, mock, spyOn, test } from "bun:test"
import { DEFAULT_TEST_TIMEOUT_MS, resetTestDeadline } from "../../../../test-support/test-deadline"
import { bounded as boundedLifecycleEvent, signal } from "./__fixtures__/live-parent-clock"
import { bounded as boundedWorkpoolEvent } from "../workpool/__fixtures__/admission"

// An injected clock: the preload resets the test deadline from performance.now before each test,
// so a runner stall is a jump of this clock, and a fake setTimeout fires exactly the timers it passed.
const originalNow = performance.now
let now = 0
performance.now = () => now
afterAll(() => {
  performance.now = originalNow
  resetTestDeadline()
})
afterEach(() => mock.restore())

// Longer than both old fixed bounds (2 s live-parent, 5 s workpool), so the old helpers fail by behaviour.
const STALL_MS = 6_000

function fakeTimeouts() {
  const pending: { readonly due: number; readonly fire: () => void }[] = []
  spyOn(globalThis, "setTimeout").mockImplementation(((fire: () => void, delay?: number) => {
    pending.push({ due: now + (delay ?? 0), fire })
    return pending.length as unknown as ReturnType<typeof setTimeout>
  }) as unknown as typeof setTimeout)
  spyOn(globalThis, "clearTimeout").mockImplementation(() => undefined)
  return {
    stall(ms: number): void {
      now += ms
      const due = pending.filter((timer) => timer.due <= now)
      pending.splice(0, pending.length, ...pending.filter((timer) => timer.due > now))
      for (const timer of due) timer.fire()
    },
  }
}

test("#given a stalled runner #when a live-parent lifecycle event arrives after the stall #then the wait succeeds within the test budget", async () => {
  // given
  const timers = fakeTimeouts()
  const event = signal<string>()
  const waited = boundedLifecycleEvent(event.promise).then(
    (value) => ({ status: "resolved" as const, value }),
    (error: unknown) => ({ status: "rejected" as const, error }),
  )

  // when
  timers.stall(STALL_MS)
  event.resolve("arrived")

  // then
  expect(await waited).toEqual({ status: "resolved", value: "arrived" })
})

test("#given a stalled runner #when a workpool event arrives after the stall #then the wait succeeds within the test budget", async () => {
  // given
  let armedMs: number | undefined
  const deadline = new AbortController()
  spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
    armedMs = ms
    return deadline.signal
  })
  const event = signal<string>()
  const waited = boundedWorkpoolEvent(event.promise).then(
    (value) => ({ status: "resolved" as const, value }),
    (error: unknown) => ({ status: "rejected" as const, error }),
  )

  // when
  now += STALL_MS
  if (armedMs !== undefined && armedMs <= STALL_MS)
    deadline.abort(new DOMException("The operation timed out.", "TimeoutError"))
  event.resolve("arrived")

  // then
  expect(await waited).toEqual({ status: "resolved", value: "arrived" })
  expect(armedMs).toBe(DEFAULT_TEST_TIMEOUT_MS * 0.9)
})

test("#given an event that never arrives #when the test budget runs out #then the wait still rejects on its own before the test times out", async () => {
  // given
  const timers = fakeTimeouts()
  const waited = boundedLifecycleEvent(new Promise<never>(() => undefined)).then(
    () => "resolved",
    (error: unknown) => (error instanceof Error ? "rejected" : "rejected with a non-error"),
  )

  // when
  timers.stall(DEFAULT_TEST_TIMEOUT_MS * 0.9)

  // then
  expect(await waited).toBe("rejected")
})
