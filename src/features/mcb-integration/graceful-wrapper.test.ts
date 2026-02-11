import { describe, it, expect, beforeEach } from "bun:test"
import { withMcbFallback } from "./graceful-wrapper"
import { markMcbUnavailable, resetMcbAvailability } from "./availability"

describe("mcb-integration/graceful-wrapper", () => {
  beforeEach(() => {
    resetMcbAvailability()
  })

  //#given a successful MCB operation
  //#when withMcbFallback wraps it
  //#then it returns success with data
  it("returns success when operation succeeds", async () => {
    const result = await withMcbFallback(
      async () => ({ items: ["a", "b"] }),
      "search",
    )
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.items).toEqual(["a", "b"])
    }
  })

  //#given a failing MCB operation
  //#when withMcbFallback wraps it
  //#then it returns degraded result and marks tool unavailable
  it("returns degraded on operation failure", async () => {
    const result = await withMcbFallback(
      async () => { throw new Error("connection refused") },
      "search",
    )
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toBe("connection refused")
      expect(result.degraded).toBe(true)
    }
  })

  //#given MCB is globally unavailable
  //#when withMcbFallback is called
  //#then it short-circuits without calling the operation
  it("short-circuits when MCB globally unavailable", async () => {
    markMcbUnavailable()
    let called = false
    const result = await withMcbFallback(
      async () => { called = true; return "data" },
    )
    expect(called).toBe(false)
    expect(result.success).toBe(false)
  })

  //#given a specific MCB tool is unavailable
  //#when withMcbFallback targets that tool
  //#then it short-circuits
  it("short-circuits when specific tool unavailable", async () => {
    markMcbUnavailable("session")
    let called = false
    const result = await withMcbFallback(
      async () => { called = true; return "data" },
      "session",
    )
    expect(called).toBe(false)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toContain("session")
    }
  })
})
