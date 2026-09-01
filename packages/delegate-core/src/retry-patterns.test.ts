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
    const guidance = error ? buildRetryGuidance(error) : ""
    const availableOptions = output.match(/Available: (.+)$/)?.[1]?.split(", ")

    expect(guidance.length).toBeGreaterThan(0)
    expect(availableOptions).toBeDefined()
    expect(availableOptions?.every((option) => guidance.includes(option))).toBe(true)
  })
})
