import { describe, test, expect } from "bun:test"
import { resolveSelector } from "./selector-resolver"

describe("resolveSelector", () => {
  describe("#given click instruction", () => {
    test("#when heuristic resolves #then returns text selector", async () => {
      const result = await resolveSelector("click Submit", "example.com/*", "", null)
      expect(result.selector).toBe('text="Submit"')
      expect(result.source).toBe("heuristic")
    })
  })

  describe("#given type instruction", () => {
    test("#when heuristic resolves #then returns field selector", async () => {
      const result = await resolveSelector("type hello into username", "example.com/*", "", null)
      expect(result.selector).toContain("username")
      expect(result.source).toBe("heuristic")
    })
  })

  describe("#given unknown instruction", () => {
    test("#when no heuristic matches #then returns fallback", async () => {
      const result = await resolveSelector("do something weird", "example.com/*", "", null)
      expect(result.confidence).toBeLessThanOrEqual(0.5)
    })
  })
})
