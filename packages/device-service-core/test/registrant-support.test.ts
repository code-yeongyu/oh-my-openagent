import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test"
import { DEFAULT_TEST_TIMEOUT_MS, resetTestDeadline } from "../../../test-support/test-deadline"
import { recorder, within } from "./registrant-support.ts"

// A slow host, replayed on an injected clock: the root preload's per-test deadline reads performance.now, and a
// fake setTimeout fires exactly the timers the elapsed time has passed. Real registrant work under load (#10814:
// a dead-endpoint retry walk took over 10 s on hosted macOS and Windows) is the same shape at full scale.
const originalNow = performance.now
let now = 0
performance.now = () => now
beforeEach(() => resetTestDeadline())
// Package-local runs do not load the root preload that restores spies, so this file restores its own.
afterEach(() => mock.restore())
const realTimers = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout }
afterAll(() => {
  performance.now = originalNow
  resetTestDeadline()
})

function slowHost() {
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

const settle = <T>(waited: Promise<T>) =>
  waited.then(
    (value) => ({ status: "resolved" as const, value }),
    (error: unknown) => ({ status: "rejected" as const, message: error instanceof Error ? "error" : String(error) }),
  )

test("#given a host so slow that the registrant event lands 12 s into the test #when within() waits for it #then it resolves inside the test's own budget", async () => {
  // given
  const host = slowHost()
  let arrive: (value: string) => void = () => undefined
  const waited = settle(within(new Promise<string>((resolve) => (arrive = resolve)), "the registrant giving up"))

  // when
  host.elapse(12_000)
  arrive("gave_up")

  // then
  expect(await waited).toEqual({ status: "resolved", value: "gave_up" })
})

test("#given part of the test budget already spent #when within() arms #then its deadline is exactly what is left of the budget", () => {
  // given
  const host = slowHost()
  now += 5_000

  // when
  void within(new Promise<never>(() => undefined), "retry 1 being scheduled").catch(() => undefined)

  // then
  expect(host.armed).toEqual([DEFAULT_TEST_TIMEOUT_MS * 0.9 - 5_000])
})

test("#given an event that never comes #when the test budget runs out #then within() fails on its own before the test times out", async () => {
  // given
  const host = slowHost()
  const waited = settle(within(new Promise<never>(() => undefined), "a register that never happens"))

  // when
  host.elapse(DEFAULT_TEST_TIMEOUT_MS * 0.9)

  // then
  expect(await waited).toEqual({ status: "rejected", message: "error" })
})

test("#given a registrant that gave up #when a recorder wait runs out #then the error lists the events it saw and when (#12733)", async () => {
  // given
  const host = slowHost()
  const seen = recorder()
  const waited = seen
    .next((event) => event.kind === "registered", "the register after the restart")
    .then(
      () => "resolved",
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    )
  seen.onEvent({ kind: "disconnected" })
  host.elapse(250)
  seen.onEvent({ kind: "connect_failed", reason: "ECONNREFUSED" })
  host.elapse(5_000)
  seen.onEvent({ kind: "gave_up" })

  // when
  host.elapse(DEFAULT_TEST_TIMEOUT_MS * 0.9)

  // then
  const message = await waited
  expect(message).toContain("for the register after the restart")
  expect(message).toContain(
    '0ms {"kind":"disconnected"}, 250ms {"kind":"connect_failed","reason":"ECONNREFUSED"}, 5250ms {"kind":"gave_up"}',
  )
})

test("#given the tests above replaced the timers #when a later test runs #then it sees the real setTimeout and clearTimeout again", () => {
  // then
  expect(globalThis.setTimeout).toBe(realTimers.setTimeout)
  expect(globalThis.clearTimeout).toBe(realTimers.clearTimeout)
})
