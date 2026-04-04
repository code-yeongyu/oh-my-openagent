/// <reference types="bun-types" />

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
    it("#when called with sonnet #then maps to anthropic claude-sonnet-4-6 object", () => {
      expect(mapClaudeModelToOpenCode("sonnet")).toEqual({ providerID: "anthropic", modelID: "claude-sonnet-4-6" })
    })

    it("#when called with opus #then maps to anthropic claude-opus-4-6 object", () => {
      expect(mapClaudeModelToOpenCode("opus")).toEqual({ providerID: "anthropic", modelID: "claude-opus-4-6" })
    })

    it("#when called with haiku #then maps to anthropic claude-haiku-4-5 object", () => {
      expect(mapClaudeModelToOpenCode("haiku")).toEqual({ providerID: "anthropic", modelID: "claude-haiku-4-5" })
    })

    it("#when called with Sonnet (capitalized) #then maps case-insensitively to object", () => {
      expect(mapClaudeModelToOpenCode("Sonnet")).toEqual({ providerID: "anthropic", modelID: "claude-sonnet-4-6" })
    })
  })

  describe("#given inherit", () => {
    it("#when called with inherit #then returns undefined", () => {
      expect(mapClaudeModelToOpenCode("inherit")).toBeUndefined()
    })
  })

  describe("#given bare Claude model name", () => {
    it("#when called with claude-sonnet-4-5-20250514 #then adds anthropic object format", () => {
      expect(mapClaudeModelToOpenCode("claude-sonnet-4-5-20250514")).toEqual({ providerID: "anthropic", modelID: "claude-sonnet-4-5-20250514" })
    })

    it("#when called with claude-opus-4-6 #then adds anthropic object format", () => {
      expect(mapClaudeModelToOpenCode("claude-opus-4-6")).toEqual({ providerID: "anthropic", modelID: "claude-opus-4-6" })
    })

    it("#when called with claude-haiku-4-5-20251001 #then adds anthropic object format", () => {
      expect(mapClaudeModelToOpenCode("claude-haiku-4-5-20251001")).toEqual({ providerID: "anthropic", modelID: "claude-haiku-4-5-20251001" })
    })

    it("#when called with claude-3-5-sonnet-20241022 #then adds anthropic object format", () => {
      expect(mapClaudeModelToOpenCode("claude-3-5-sonnet-20241022")).toEqual({ providerID: "anthropic", modelID: "claude-3-5-sonnet-20241022" })
    })
  })

  describe("#given model with dot version numbers", () => {
    it("#when called with claude-3.5-sonnet #then normalizes dots and returns object format", () => {
      expect(mapClaudeModelToOpenCode("claude-3.5-sonnet")).toEqual({ providerID: "anthropic", modelID: "claude-3-5-sonnet" })
    })

    it("#when called with claude-3.5-sonnet-20241022 #then normalizes dots and returns object format", () => {
      expect(mapClaudeModelToOpenCode("claude-3.5-sonnet-20241022")).toEqual({ providerID: "anthropic", modelID: "claude-3-5-sonnet-20241022" })
    })
  })

  describe("#given model already in provider/model format", () => {
    it("#when called with anthropic/claude-sonnet-4-6 #then splits into object format", () => {
      expect(mapClaudeModelToOpenCode("anthropic/claude-sonnet-4-6")).toEqual({ providerID: "anthropic", modelID: "claude-sonnet-4-6" })
    })

    it("#when called with anthropic/claude-3.5-sonnet #then normalizes dots before splitting into object format", () => {
      expect(mapClaudeModelToOpenCode("anthropic/claude-3.5-sonnet")).toEqual({ providerID: "anthropic", modelID: "claude-3-5-sonnet" })
    })

    it("#when called with openai/gpt-5.2 #then splits into object format", () => {
      expect(mapClaudeModelToOpenCode("openai/gpt-5.2")).toEqual({ providerID: "openai", modelID: "gpt-5.2" })
    })
  })

  describe("#given non-Claude bare model", () => {
    it("#when called with gpt-5.2 #then returns undefined", () => {
      expect(mapClaudeModelToOpenCode("gpt-5.2")).toBeUndefined()
    })

    it("#when called with gemini-3-flash #then returns undefined", () => {
      expect(mapClaudeModelToOpenCode("gemini-3-flash")).toBeUndefined()
    })
  })

  describe("#given prototype property name", () => {
    it("#when called with constructor #then returns undefined", () => {
      expect(mapClaudeModelToOpenCode("constructor")).toBeUndefined()
    })

    it("#when called with toString #then returns undefined", () => {
      expect(mapClaudeModelToOpenCode("toString")).toBeUndefined()
    })
  })

  describe("#given model with leading/trailing whitespace", () => {
    it("#when called with padded string #then trims before returning object format", () => {
      expect(mapClaudeModelToOpenCode("  claude-sonnet-4-6  ")).toEqual({ providerID: "anthropic", modelID: "claude-sonnet-4-6" })
    })
  })
})
