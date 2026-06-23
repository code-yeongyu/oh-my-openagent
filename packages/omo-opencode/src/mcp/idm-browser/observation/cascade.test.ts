import { describe, test, expect } from "bun:test"
import type { ObservationLevel, CascadeResult } from "./cascade"

describe("observation cascade types", () => {
  test("#given CascadeResult shape #when typed #then compiles", () => {
    const result: CascadeResult = {
      level: "axtree",
      axtree: {
        url: "https://example.com",
        title: "Example",
        elements: [],
        interactiveCount: 0,
        timestamp: Date.now(),
      },
    }
    expect(result.level).toBe("axtree")
  })

  test("#given all observation levels #when checked #then valid enum values", () => {
    const levels: ObservationLevel[] = ["axtree", "dom", "vision", "full"]
    expect(levels).toHaveLength(4)
  })
})
