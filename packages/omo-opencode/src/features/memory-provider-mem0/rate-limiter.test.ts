const { describe, expect, it, spyOn } = require("bun:test")

import { Mem0RateLimitError, Mem0RateLimiter } from "./rate-limiter"

describe("Mem0RateLimiter", () => {
  it("#given successful operation #when executed #then returns result without retry", async () => {
    const rateLimiter = new Mem0RateLimiter()
    const result = await rateLimiter.executeWithRetry(async () => "ok", "/memories")

    expect(result).toBe("ok")
  })

  it("#given 429 failure #when retry remains #then retries and returns result", async () => {
    const rateLimiter = new Mem0RateLimiter({ initialBackoffMs: 0, jitterFactor: 0, maxRetries: 2 })
    let attempts = 0

    const result = await rateLimiter.executeWithRetry(async () => {
      attempts++
      if (attempts === 1) {
        throw new Error("429 too many requests")
      }
      return "ok"
    }, "/memories")

    expect(result).toBe("ok")
    expect(attempts).toBe(2)
  })

  it("#given repeated 429 failures #when retries exhausted #then throws rate limit error", async () => {
    const rateLimiter = new Mem0RateLimiter({ initialBackoffMs: 0, jitterFactor: 0, maxRetries: 1 })

    await expect(
      rateLimiter.executeWithRetry(async () => {
        throw new Error("429 too many requests")
      }, "/search"),
    ).rejects.toBeInstanceOf(Mem0RateLimitError)
  })

  it("#given retry-after hint #when retrying #then waits for retry-after duration", async () => {
    const rateLimiter = new Mem0RateLimiter({ initialBackoffMs: 10, jitterFactor: 0, maxRetries: 1 })
    const timeoutSpy = spyOn(globalThis, "setTimeout").mockImplementation(
      Object.assign(
        (handler: TimerHandler) => {
          if (typeof handler === "function") {
            handler()
          }

          return 0 as unknown as ReturnType<typeof setTimeout>
        },
        { __promisify__: setTimeout.__promisify__ },
      ),
    )

    try {
      await expect(
        rateLimiter.executeWithRetry(async () => {
          throw new Error("429 Retry-After: 2")
        }, "/search"),
      ).rejects.toMatchObject({ retryAfterMs: 2000 })

      expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Function), 2000)
    } finally {
      timeoutSpy.mockRestore()
    }
  })
})
