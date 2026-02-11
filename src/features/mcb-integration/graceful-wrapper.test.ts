import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import * as warnings from "./degradation-warnings"
import * as syncQueue from "./sync-queue"
import { withMcbFallback } from "./graceful-wrapper"
import { markMcbUnavailable, resetMcbAvailability } from "./availability"

describe("mcb-integration/graceful-wrapper", () => {
  let enqueueSpy: ReturnType<typeof spyOn>
  let warningSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    resetMcbAvailability()
    enqueueSpy = spyOn(syncQueue, "enqueueOperation").mockResolvedValue(undefined)
    warningSpy = spyOn(warnings, "emitMcbDegradationWarning").mockImplementation(() => {})
  })

  afterEach(() => {
    enqueueSpy.mockRestore()
    warningSpy.mockRestore()
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

  //#given a failing operation and queue metadata
  //#when withMcbFallback handles the failure
  //#then it queues the operation for later sync
  it("queues failed operations when descriptor and projectDir are provided", async () => {
    const result = await withMcbFallback(
      async () => {
        throw new Error("connection refused")
      },
      "memory",
      {
        tool: "memory",
        action: "store",
        params: { path: "artifact.md" },
        maxRetries: 3,
        source: "test",
      },
      "/tmp/project",
    )

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.queued).toBe(true)
    }
    expect(enqueueSpy).toHaveBeenCalledTimes(1)
  })

  //#given MCB unavailability
  //#when withMcbFallback short-circuits
  //#then warning is emitted for the tool
  it("emits degradation warning when tool is unavailable", async () => {
    markMcbUnavailable("search")
    await withMcbFallback(async () => "data", "search")
    expect(warningSpy).toHaveBeenCalledWith("search")
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
