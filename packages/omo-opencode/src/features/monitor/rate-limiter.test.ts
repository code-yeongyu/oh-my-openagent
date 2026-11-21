import { describe, expect, test } from "bun:test"
import { MonitorRateLimiter } from "./rate-limiter"

describe("MonitorRateLimiter", () => {
  test("#given a fresh limiter #when batches arrive at once #then the burst passes and the rest are refused", () => {
    const limiter = new MonitorRateLimiter(() => 0, 3, 2_000)
    expect([limiter.tryTake(), limiter.tryTake(), limiter.tryTake(), limiter.tryTake()]).toEqual([
      true,
      true,
      true,
      false,
    ])
  })

  test("#given an empty bucket #when the refill interval passes #then one more batch is allowed", () => {
    let now = 0
    const limiter = new MonitorRateLimiter(() => now, 1, 2_000)
    limiter.tryTake()
    now = 1_999
    expect(limiter.tryTake()).toBe(false)
    now = 2_000
    expect(limiter.tryTake()).toBe(true)
    expect(limiter.tryTake()).toBe(false)
  })
})
