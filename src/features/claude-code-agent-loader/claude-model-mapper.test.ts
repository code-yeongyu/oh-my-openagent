import { describe, it, expect } from "bun:test"
import { mapClaudeModelToOpenCode } from "./claude-model-mapper"

describe("mapClaudeModelToOpenCode", () => {
  describe("#given undefined or empty input", () => {
    it("#when called with undefined #then returns undefined", () => {
      expect(mapClaudeModelToOpenCode(undefined)).toBeUndefined()
    })

    it("#when called with empty string #then returns undefined", () => {
      expect(mapClaudeModelToOpenCode("")).toBeUndefined()
    })

    it("#when called with whitespace-only string #then returns undefined", () => {
      expect(mapClaudeModelToOpenCode("   ")).toBeUndefined()
    })
  })

  describe("#given model with date suffix", () => {
    it("#when called with claude-sonnet-4-5-20250514 #then strips date suffix", () => {
      expect(mapClaudeModelToOpenCode("claude-sonnet-4-5-20250514")).toBe("claude-sonnet-4-5")
    })

    it("#when called with claude-opus-4-20250414 #then strips date suffix", () => {
      expect(mapClaudeModelToOpenCode("claude-opus-4-20250414")).toBe("claude-opus-4")
    })

    it("#when called with claude-haiku-4-5-20250514 #then strips date suffix", () => {
      expect(mapClaudeModelToOpenCode("claude-haiku-4-5-20250514")).toBe("claude-haiku-4-5")
    })

    it("#when called with claude-3-5-sonnet-20241022 #then strips date suffix", () => {
      expect(mapClaudeModelToOpenCode("claude-3-5-sonnet-20241022")).toBe("claude-3-5-sonnet")
    })
  })

  describe("#given model with dot version numbers", () => {
    it("#when called with claude-3.5-sonnet #then normalizes dots to dashes", () => {
      expect(mapClaudeModelToOpenCode("claude-3.5-sonnet")).toBe("claude-3-5-sonnet")
    })

    it("#when called with claude-3.5-sonnet-20241022 #then normalizes dots and strips date", () => {
      expect(mapClaudeModelToOpenCode("claude-3.5-sonnet-20241022")).toBe("claude-3-5-sonnet")
    })
  })

  describe("#given already-normalized model", () => {
    it("#when called with claude-sonnet-4-6 #then returns unchanged", () => {
      expect(mapClaudeModelToOpenCode("claude-sonnet-4-6")).toBe("claude-sonnet-4-6")
    })

    it("#when called with claude-opus-4-6 #then returns unchanged", () => {
      expect(mapClaudeModelToOpenCode("claude-opus-4-6")).toBe("claude-opus-4-6")
    })

    it("#when called with claude-haiku-4-5 #then returns unchanged", () => {
      expect(mapClaudeModelToOpenCode("claude-haiku-4-5")).toBe("claude-haiku-4-5")
    })
  })

  describe("#given non-Claude model", () => {
    it("#when called with gpt-5.2 #then normalizes dots only", () => {
      expect(mapClaudeModelToOpenCode("gpt-5.2")).toBe("gpt-5-2")
    })

    it("#when called with gemini-3-flash #then returns unchanged", () => {
      expect(mapClaudeModelToOpenCode("gemini-3-flash")).toBe("gemini-3-flash")
    })

    it("#when called with a custom model name #then returns unchanged", () => {
      expect(mapClaudeModelToOpenCode("my-custom-model")).toBe("my-custom-model")
    })
  })

  describe("#given model with leading/trailing whitespace", () => {
    it("#when called with padded string #then trims before mapping", () => {
      expect(mapClaudeModelToOpenCode("  claude-sonnet-4-5-20250514  ")).toBe("claude-sonnet-4-5")
    })
  })
})
