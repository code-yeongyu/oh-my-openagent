/**
 * Intent Modes Tests
 */

import { describe, test, expect } from "bun:test"
import {
  detectIntentMode,
  getModeInstructions,
  getIntentModeInstructions,
  DEFAULT_INTENT_MODE_CONFIG,
} from "./intent-modes"

describe("Intent Modes", () => {
  describe("detectIntentMode", () => {
    test("should detect review mode for 'review' keyword", () => {
      expect(detectIntentMode("Please review this code")).toBe("review")
    })

    test("should detect review mode for '审查' keyword", () => {
      expect(detectIntentMode("请审查这段代码")).toBe("review")
    })

    test("should detect review mode for 'code review' phrase", () => {
      expect(detectIntentMode("I need a code review for this PR")).toBe("review")
    })

    test("should detect review mode for 'check this code'", () => {
      expect(detectIntentMode("Can you check this code for issues?")).toBe("review")
    })

    test("should detect research mode for 'research' keyword", () => {
      expect(detectIntentMode("I want to research different approaches")).toBe("research")
    })

    test("should detect research mode for '研究' keyword", () => {
      expect(detectIntentMode("我想研究一下这个问题")).toBe("research")
    })

    test("should detect research mode for '探索' keyword", () => {
      expect(detectIntentMode("让我们探索一下可能的方案")).toBe("research")
    })

    test("should detect research mode for 'explore' keyword", () => {
      expect(detectIntentMode("Let's explore the options")).toBe("research")
    })

    test("should detect research mode for 'how does' phrase", () => {
      expect(detectIntentMode("How does this algorithm work?")).toBe("research")
    })

    test("should detect research mode for 'explain' keyword", () => {
      expect(detectIntentMode("Please explain the architecture")).toBe("research")
    })

    test("should default to dev mode for normal requests", () => {
      expect(detectIntentMode("Add a new feature")).toBe("dev")
    })

    test("should default to dev mode for implementation requests", () => {
      expect(detectIntentMode("Implement the login functionality")).toBe("dev")
    })

    test("should default to dev mode for fix requests", () => {
      expect(detectIntentMode("Fix the bug in the payment module")).toBe("dev")
    })

    test("should respect explicit --mode=review flag", () => {
      expect(detectIntentMode("Add feature --mode=review")).toBe("review")
    })

    test("should respect explicit --mode=research flag", () => {
      expect(detectIntentMode("Fix bug --mode=research")).toBe("research")
    })

    test("should respect explicit --mode=dev flag", () => {
      expect(detectIntentMode("Review code --mode=dev")).toBe("dev")
    })

    test("should prioritize review over research", () => {
      // When both keywords present, review takes priority
      expect(detectIntentMode("Research and review the code")).toBe("review")
    })

    test("should return dev when disabled", () => {
      const config = { ...DEFAULT_INTENT_MODE_CONFIG, enabled: false }
      expect(detectIntentMode("Review this code", config)).toBe("dev")
    })

    test("should respect custom keywords", () => {
      const config = {
        ...DEFAULT_INTENT_MODE_CONFIG,
        custom_keywords: { review: ["evaluate"] },
      }
      expect(detectIntentMode("Please evaluate this", config)).toBe("review")
    })
  })

  describe("getModeInstructions", () => {
    test("should return dev instructions", () => {
      const instructions = getModeInstructions("dev")
      expect(instructions).toContain("DEVELOPMENT")
      expect(instructions).toContain("clean, working code")
    })

    test("should return review instructions", () => {
      const instructions = getModeInstructions("review")
      expect(instructions).toContain("REVIEW")
      expect(instructions).toContain("Finding bugs")
      expect(instructions).toContain("Critical Issues")
    })

    test("should return research instructions", () => {
      const instructions = getModeInstructions("research")
      expect(instructions).toContain("RESEARCH")
      expect(instructions).toContain("Understanding before acting")
      expect(instructions).toContain("Key Findings")
    })
  })

  describe("getIntentModeInstructions", () => {
    test("should return mode and instructions together", () => {
      const result = getIntentModeInstructions("Please review this code")
      expect(result.mode).toBe("review")
      expect(result.instructions).toContain("REVIEW")
    })

    test("should return dev mode for normal request", () => {
      const result = getIntentModeInstructions("Add a new feature")
      expect(result.mode).toBe("dev")
      expect(result.instructions).toContain("DEVELOPMENT")
    })
  })
})
