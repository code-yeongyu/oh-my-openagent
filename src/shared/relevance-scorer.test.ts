import { describe, expect, it } from "bun:test"
import { scoreRelevance, type IntentMode, type Resource } from "./relevance-scorer"

describe("relevance-scorer", () => {
  //#given default mode
  describe("default mode", () => {
    //#when scoring any file
    //#then returns base score of 0.5
    it("returns base score for any file", () => {
      const resource: Resource = { path: "src/index.ts" }
      const score = scoreRelevance(resource, "default")
      expect(score).toBe(0.5)
    })
  })

  //#given review mode
  describe("review mode", () => {
    //#when scoring test files
    //#then boosts score by 1.5x
    it("boosts .test.ts files", () => {
      const resource: Resource = { path: "src/utils.test.ts" }
      const score = scoreRelevance(resource, "review")
      expect(score).toBe(0.75) // 0.5 * 1.5
    })

    it("boosts .spec.ts files", () => {
      const resource: Resource = { path: "src/utils.spec.ts" }
      const score = scoreRelevance(resource, "review")
      expect(score).toBe(0.75)
    })

    it("boosts __tests__ directory files", () => {
      const resource: Resource = { path: "src/__tests__/utils.ts" }
      const score = scoreRelevance(resource, "review")
      expect(score).toBe(0.75)
    })

    //#when scoring non-test files
    //#then returns base score
    it("returns base score for non-test files", () => {
      const resource: Resource = { path: "src/index.ts" }
      const score = scoreRelevance(resource, "review")
      expect(score).toBe(0.5)
    })
  })

  //#given research mode
  describe("research mode", () => {
    //#when scoring documentation files
    //#then boosts score by 1.5x
    it("boosts .md files", () => {
      const resource: Resource = { path: "README.md" }
      const score = scoreRelevance(resource, "research")
      expect(score).toBe(0.75)
    })

    it("boosts docs/ directory files", () => {
      const resource: Resource = { path: "docs/guide.ts" }
      const score = scoreRelevance(resource, "research")
      expect(score).toBe(0.75)
    })

    it("boosts AGENTS.md files", () => {
      const resource: Resource = { path: "src/shared/AGENTS.md" }
      const score = scoreRelevance(resource, "research")
      expect(score).toBe(0.75)
    })

    //#when scoring non-documentation files
    //#then returns base score
    it("returns base score for non-doc files", () => {
      const resource: Resource = { path: "src/index.ts" }
      const score = scoreRelevance(resource, "research")
      expect(score).toBe(0.5)
    })
  })

  //#given implement mode
  describe("implement mode", () => {
    //#when scoring source files
    //#then boosts score by 1.3x
    it("boosts .ts files in src/", () => {
      const resource: Resource = { path: "src/utils.ts" }
      const score = scoreRelevance(resource, "implement")
      expect(score).toBe(0.65) // 0.5 * 1.3
    })

    it("boosts .tsx files", () => {
      const resource: Resource = { path: "src/components/Button.tsx" }
      const score = scoreRelevance(resource, "implement")
      expect(score).toBe(0.65)
    })

    it("boosts lib/ directory files", () => {
      const resource: Resource = { path: "lib/helpers.ts" }
      const score = scoreRelevance(resource, "implement")
      expect(score).toBe(0.65)
    })

    //#when scoring test files in implement mode
    //#then returns base score (tests not boosted in implement)
    it("returns base score for test files", () => {
      const resource: Resource = { path: "src/utils.test.ts" }
      const score = scoreRelevance(resource, "implement")
      expect(score).toBe(0.5)
    })
  })

  //#given debug mode
  describe("debug mode", () => {
    //#when scoring log files
    //#then boosts score by 1.5x
    it("boosts .log files", () => {
      const resource: Resource = { path: "logs/error.log" }
      const score = scoreRelevance(resource, "debug")
      expect(score).toBe(0.75)
    })

    it("boosts errors/ directory files", () => {
      const resource: Resource = { path: "errors/crash-report.txt" }
      const score = scoreRelevance(resource, "debug")
      expect(score).toBe(0.75)
    })

    it("boosts files with error in name", () => {
      const resource: Resource = { path: "src/error-handler.ts" }
      const score = scoreRelevance(resource, "debug")
      expect(score).toBe(0.75)
    })

    it("boosts stack trace files", () => {
      const resource: Resource = { path: "debug/stacktrace.txt" }
      const score = scoreRelevance(resource, "debug")
      expect(score).toBe(0.75)
    })

    //#when scoring non-debug files
    //#then returns base score
    it("returns base score for regular source files", () => {
      const resource: Resource = { path: "src/utils.ts" }
      const score = scoreRelevance(resource, "debug")
      expect(score).toBe(0.5)
    })
  })

  //#given score boundaries
  describe("score boundaries", () => {
    //#when score would exceed 1.0
    //#then clamps to 1.0
    it("clamps score to maximum of 1.0", () => {
      const resource: Resource = { path: "src/__tests__/error.test.ts" }
      // Even with multiple boosts, should not exceed 1.0
      const score = scoreRelevance(resource, "review")
      expect(score).toBeLessThanOrEqual(1.0)
    })

    //#when scoring any resource
    //#then score is at least 0
    it("returns score of at least 0", () => {
      const resource: Resource = { path: "random/file.xyz" }
      const modes: IntentMode[] = ["review", "research", "implement", "debug", "default"]
      for (const mode of modes) {
        expect(scoreRelevance(resource, mode)).toBeGreaterThanOrEqual(0)
      }
    })
  })

  //#given resource with type override
  describe("resource type override", () => {
    //#when type is explicitly provided
    //#then uses type for scoring instead of path inference
    it("respects explicit type over path inference", () => {
      const resource: Resource = { path: "data/file.json", type: "test" }
      const score = scoreRelevance(resource, "review")
      expect(score).toBe(0.75) // boosted as test file
    })
  })
})
