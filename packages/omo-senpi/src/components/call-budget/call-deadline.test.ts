import { describe, expect, test } from "bun:test"

import { callWait, commandWaitMs, type WaitClock } from "./call-deadline"

const virtualClock = (at: number): WaitClock => ({ now: () => at, after: () => () => undefined })

describe("callWait.scoped", () => {
  test("#given a call's own clock far from system time #when a remote command inside the scope sizes its wait #then it gets what is left of the call's deadline", async () => {
    const wait = callWait({ deadline_ms: 5_000 }, virtualClock(1_000))
    const sized = await wait.scoped(async () => commandWaitMs(30_000))
    expect(sized).toBeGreaterThan(4_000)
    expect(sized).toBeLessThanOrEqual(5_000)
  })

  test("#given no deadline #when a remote command inside the scope sizes its wait #then it keeps its own bound", async () => {
    const wait = callWait({}, virtualClock(1_000))
    expect(await wait.scoped(async () => commandWaitMs(30_000))).toBe(30_000)
  })
})
