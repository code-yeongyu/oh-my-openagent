import { describe, expect, test } from "bun:test"
import { buildRetryGuidance, detectDelegateTaskError } from "./index"

describe("delegate task retry contract", () => {
  test("#given unknown category output #when detected #then retry guidance preserves available options", () => {
    const output = '[ERROR] Unknown category: "bad". Available: visual-engineering, ultrabrain'
    const error = detectDelegateTaskError(output)

    expect(error).toEqual({
      errorType: "unknown_category",
      originalOutput: output,
    })
    expect(error ? buildRetryGuidance(error) : "").toContain("**Available Options**: visual-engineering, ultrabrain")
  })

  test("#given unknown category output without error prefix #when detected #then retry guidance still applies", () => {
    const output = 'Unknown category: "bad". Available: visual-engineering, ultrabrain'
    const error = detectDelegateTaskError(output)

    expect(error).toEqual({
      errorType: "unknown_category",
      originalOutput: output,
    })
  })
})
