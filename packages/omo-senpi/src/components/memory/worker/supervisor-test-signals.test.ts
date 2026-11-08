import { expect, jest, test } from "bun:test"
import { slotHarness } from "./supervisor-slot.test-support"
import { waitForTestState } from "./supervisor-test-signals"

test("#given subscription fails #then the waiter rejects without leaving a timeout", async () => {
  const timer = jest.spyOn(globalThis, "setTimeout")
  try {
    const failure = new Error("subscription failed")
    const waiting = waitForTestState(() => { throw failure }, () => undefined, 1_000, "state")
    await expect(waiting).rejects.toBe(failure)
    expect(timer).not.toHaveBeenCalled()
  } finally {
    timer.mockRestore()
  }
})

test("#given the harness budget is consumed #then a later wait uses the original deadline", async () => {
  const now = Date.now()
  const clock = jest.spyOn(Date, "now").mockReturnValue(now)
  const harness = await slotHarness(3_000)
  try {
    await harness.waitQueued(0)
    clock.mockReturnValue(now + 2_000)
    await expect(harness.waitStarted("never-started")).rejects.toThrow("waited 0ms for child never-started started")
  } finally {
    clock.mockRestore()
    await harness.cleanup()
  }
}, 3_000)
