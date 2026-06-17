import { describe, expect, it } from "bun:test"
import { ContinuationConfigSchema } from "./continuation"

describe("ContinuationConfigSchema", () => {
  it("accepts valid continuation timing overrides", () => {
    // given
    const rawConfig = {
      cooldownMs: 5000,
      abortWindowMs: 3000,
      maxStagnationCount: 3,
      maxConsecutiveFailures: 5,
      failureResetWindowMs: 300000,
      countdownSeconds: 2,
    }

    // when
    const result = ContinuationConfigSchema.safeParse(rawConfig)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toEqual(rawConfig)
    }
  })

  it("rejects values below the supported minimums", () => {
    // given
    const invalidInputs = [
      { cooldownMs: 999 },
      { abortWindowMs: 499 },
      { maxStagnationCount: 0 },
      { maxConsecutiveFailures: 0 },
      { failureResetWindowMs: 29999 },
      { countdownSeconds: 0 },
    ]

    // when
    const results = invalidInputs.map((input) => ContinuationConfigSchema.safeParse(input))

    // then
    expect(results.every((result) => !result.success)).toBe(true)
  })
})
