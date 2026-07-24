import { describe, expect, test } from "bun:test"
import { buildRetryGuidance, DELEGATE_TASK_ERROR_PATTERNS, detectDelegateTaskError } from "./index"

describe("delegate task retry contract", () => {
  test("#given every known task error pattern #when detected #then maps to the configured error type", () => {
    for (const pattern of DELEGATE_TASK_ERROR_PATTERNS) {
      const output = `[ERROR] ${pattern.pattern}`

      expect(detectDelegateTaskError(output)).toEqual({
        errorType: pattern.errorType,
        originalOutput: output,
      })
    }
  })

  test("#given unknown category output #when detected #then retry guidance preserves available options", () => {
    const output = '[ERROR] Unknown category: "bad". Available: visual-engineering, ultrabrain'
    const error = detectDelegateTaskError(output)

    expect(error).toEqual({
      errorType: "unknown_category",
      originalOutput: output,
    })
    expect(error ? buildRetryGuidance(error) : "").toContain("**Available Options**: visual-engineering, ultrabrain")
  })

  test("#given invalid arguments without known pattern #when detected #then no retry error is returned", () => {
    expect(detectDelegateTaskError("Invalid arguments: unrelated validation failure")).toBe(null)
  })

  test("#given unknown error type #when building guidance #then returns generic task retry guidance", () => {
    expect(
      buildRetryGuidance({
        errorType: "new_error_type",
        originalOutput: "[ERROR] new failure",
      })
    ).toBe("[task ERROR] Fix the error and retry with correct parameters.")
  })
})
