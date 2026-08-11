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

  test("#given missing category or subagent output #when detected #then retry guidance uses a valid category example", () => {
    const output = "[ERROR] Must provide either category or subagent_type"
    const detected = detectDelegateTaskError(output)

    expect(detected).not.toBeNull()
    const guidance = buildRetryGuidance(detected!)

    expect(guidance).toContain("category='unspecified-low'")
    expect(guidance).not.toContain("category='general'")
  })

  test("#given mutually exclusive category and subagent output #when detected #then retry guidance presents valid category examples", () => {
    const output = "[ERROR] Invalid arguments: Provide EITHER category OR subagent_type, not both."
    const detected = detectDelegateTaskError(output)

    expect(detected).not.toBeNull()
    const guidance = buildRetryGuidance(detected!)

    expect(guidance).toContain("unspecified-low")
    expect(guidance).toContain("quick")
    expect(guidance).not.toContain("'general'")
  })
})
