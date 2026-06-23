import { describe, expect, test } from "bun:test"
import { dampenPreference } from "./preference-dampener"

describe("dampenPreference", () => {
  describe("#given no change #when dampened #then applied equals previous", () => {
    test("returns the previous value unchanged", () => {
      const result = dampenPreference("rule-1", 0.5, 0.5)

      expect(result.applied).toBe(0.5)
    })
  })

  describe("#given a small positive change #when dampened #then applied equals proposed", () => {
    test("returns the proposed value unchanged", () => {
      const result = dampenPreference("rule-1", 0.5, 0.6)

      expect(result.applied).toBe(0.6)
    })
  })

  describe("#given a large positive change #when dampened #then applied is capped", () => {
    test("caps the applied value at previous plus 0.2", () => {
      const result = dampenPreference("rule-1", 0.5, 1)

      expect(result.applied).toBe(0.7)
    })
  })

  describe("#given a large negative change #when dampened #then applied is capped", () => {
    test("caps the applied value at previous minus 0.2", () => {
      const result = dampenPreference("rule-1", 0.5, 0)

      expect(result.applied).toBe(0.3)
    })
  })

  describe("#given an exact boundary change #when dampened #then applied equals proposed", () => {
    test("does not clamp the exact +0.2 delta", () => {
      const result = dampenPreference("rule-1", 0.3, 0.5)

      expect(result.applied).toBe(0.5)
    })
  })

  describe("#given any valid inputs #when dampened #then returns all fields", () => {
    test("returns the correct ruleId, previous, proposed, and applied fields", () => {
      const result = dampenPreference("rule-123", 0.25, 0.9)

      expect(result).toEqual({
        ruleId: "rule-123",
        previous: 0.25,
        proposed: 0.9,
        applied: 0.45,
      })
    })
  })
})
