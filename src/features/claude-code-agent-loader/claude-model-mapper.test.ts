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

  describe("#given Claude Code alias", () => {
    it("#when called with sonnet #then maps to anthropic/claude-sonnet-4-6", () => {
      expect(mapClaudeModelToOpenCode("sonnet")).toBe("anthropic/claude-sonnet-4-6")
    })

    it("#when called with opus #then maps to anthropic/claude-opus-4-6", () => {
      expect(mapClaudeModelToOpenCode("opus")).toBe("anthropic/claude-opus-4-6")
    })

    it("#when called with haiku #then maps to anthropic/claude-haiku-4-5", () => {
      expect(mapClaudeModelToOpenCode("haiku")).toBe("anthropic/claude-haiku-4-5")
    })

    it("#when called with Sonnet (capitalized) #then maps case-insensitively", () => {
      expect(mapClaudeModelToOpenCode("Sonnet")).toBe("anthropic/claude-sonnet-4-6")
    })
  })

  describe("#given inherit", () => {
    it("#when called with inherit #then returns undefined", () => {
      expect(mapClaudeModelToOpenCode("inherit")).toBeUndefined()
    })
  })

  describe("#given bare Claude model name", () => {
    it("#when called with claude-sonnet-4-5-20250514 #then adds anthropic prefix", () => {
      expect(mapClaudeModelToOpenCode("claude-sonnet-4-5-20250514")).toBe("anthropic/claude-sonnet-4-5-20250514")
    })

    it("#when called with claude-opus-4-6 #then adds anthropic prefix", () => {
      expect(mapClaudeModelToOpenCode("claude-opus-4-6")).toBe("anthropic/claude-opus-4-6")
    })

    it("#when called with claude-haiku-4-5-20251001 #then adds anthropic prefix", () => {
      expect(mapClaudeModelToOpenCode("claude-haiku-4-5-20251001")).toBe("anthropic/claude-haiku-4-5-20251001")
    })

    it("#when called with claude-3-5-sonnet-20241022 #then adds anthropic prefix", () => {
      expect(mapClaudeModelToOpenCode("claude-3-5-sonnet-20241022")).toBe("anthropic/claude-3-5-sonnet-20241022")
    })
  })

  describe("#given model with dot version numbers", () => {
    it("#when called with claude-3.5-sonnet #then normalizes dots and adds prefix", () => {
      expect(mapClaudeModelToOpenCode("claude-3.5-sonnet")).toBe("anthropic/claude-3-5-sonnet")
    })

    it("#when called with claude-3.5-sonnet-20241022 #then normalizes dots and adds prefix", () => {
      expect(mapClaudeModelToOpenCode("claude-3.5-sonnet-20241022")).toBe("anthropic/claude-3-5-sonnet-20241022")
    })
  })

  describe("#given model already in provider/model format", () => {
    it("#when called with anthropic/claude-sonnet-4-6 #then passes through unchanged", () => {
      expect(mapClaudeModelToOpenCode("anthropic/claude-sonnet-4-6")).toBe("anthropic/claude-sonnet-4-6")
    })

    it("#when called with openai/gpt-5.2 #then passes through unchanged", () => {
      expect(mapClaudeModelToOpenCode("openai/gpt-5.2")).toBe("openai/gpt-5.2")
    })
  })

  describe("#given non-Claude bare model", () => {
    it("#when called with gpt-5.2 #then normalizes dots without adding prefix", () => {
      expect(mapClaudeModelToOpenCode("gpt-5.2")).toBe("gpt-5-2")
    })

    it("#when called with gemini-3-flash #then returns unchanged", () => {
      expect(mapClaudeModelToOpenCode("gemini-3-flash")).toBe("gemini-3-flash")
    })
  })

  describe("#given model with leading/trailing whitespace", () => {
    it("#when called with padded string #then trims before mapping", () => {
      expect(mapClaudeModelToOpenCode("  claude-sonnet-4-6  ")).toBe("anthropic/claude-sonnet-4-6")
    })
  })
})
