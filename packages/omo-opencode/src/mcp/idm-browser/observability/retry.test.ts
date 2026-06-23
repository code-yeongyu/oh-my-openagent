import { describe, test, expect } from "bun:test"
import { withRetry } from "./retry"

describe("withRetry", () => {
  test("#given succeeding function #when called #then returns result", async () => {
    const result = await withRetry(() => Promise.resolve(42))
    expect(result).toBe(42)
  })

  test("#given function failing then succeeding #when retried #then returns result", async () => {
    let attempt = 0
    const result = await withRetry(async () => {
      attempt++
      if (attempt < 2) throw new Error("transient")
      return "ok"
    }, { baseDelayMs: 10, maxAttempts: 3 })
    expect(result).toBe("ok")
    expect(attempt).toBe(2)
  })

  test("#given always-failing function #when max attempts reached #then throws", async () => {
    await expect(
      withRetry(() => Promise.reject(new Error("permanent")), { maxAttempts: 2, baseDelayMs: 10 })
    ).rejects.toThrow("permanent")
  })
})
