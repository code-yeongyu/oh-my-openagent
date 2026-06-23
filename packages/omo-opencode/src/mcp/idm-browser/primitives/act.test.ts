import { describe, test, expect } from "bun:test"
import type { ActResult } from "./act"

describe("act types", () => {
  test("#given ActResult shape #when typed #then compiles", () => {
    const result: ActResult = {
      success: true,
      selector: "button:has-text(\"Submit\")",
      source: "cache",
    }
    expect(result.success).toBe(true)
    expect(result.source).toBe("cache")
  })

  test("#given failed ActResult #when error present #then carries message", () => {
    const result: ActResult = {
      success: false,
      selector: "text=\"nope\"",
      source: "heuristic",
      error: "Timeout",
    }
    expect(result.error).toBe("Timeout")
  })
})
