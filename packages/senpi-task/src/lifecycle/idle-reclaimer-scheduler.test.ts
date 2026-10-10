import { describe, expect, test } from "bun:test"
import * as context from "./context"
import type { IdleReclaimerTimer } from "./port"

describe("idle reclaimer long durations", () => {
  test("#given retention above the native timer limit #when chunks expire #then only the full configured cadence fires and all chunks remain unrefed", () => {
    expect(context).toHaveProperty("createIdleReclaimerScheduler")
    const scheduled: Array<{ callback: () => void; delay: number; timer: IdleReclaimerTimer }> = []
    const cleared: IdleReclaimerTimer[] = []
    let unrefs = 0
    let sweeps = 0
    const scheduler = context.createIdleReclaimerScheduler({
      setTimeout: (callback, delay) => {
        const timer = { unref: () => { unrefs += 1 } }
        scheduled.push({ callback, delay, timer })
        return timer
      },
      clearTimeout: (timer) => { cleared.push(timer) },
    })
    const interval = scheduler.setInterval(() => { sweeps += 1 }, 2_147_483_647 + 37)
    interval.unref?.()
    expect(scheduled.map((entry) => entry.delay)).toEqual([2_147_483_647])
    scheduled[0]?.callback()
    expect(sweeps).toBe(0)
    expect(scheduled.map((entry) => entry.delay)).toEqual([2_147_483_647, 37])
    scheduled[1]?.callback()
    expect(sweeps).toBe(1)
    expect(scheduled.map((entry) => entry.delay)).toEqual([2_147_483_647, 37, 2_147_483_647])
    expect(unrefs).toBe(3)
    scheduler.clearInterval(interval)
    expect(cleared).toEqual([scheduled[2]?.timer])
  })
})
