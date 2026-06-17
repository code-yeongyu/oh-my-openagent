import { SUPPORTED_PROVIDERS, SUPPORTED_MODELS } from "@oh-my-opencode/model-core";
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
      expect(mapClaudeModelToOpenCode("sonnet")).toEqual({ providerID: SUPPORTED_PROVIDERS.ANTHROPIC, modelID: SUPPORTED_MODELS.CLAUDE_SONNET_4_6 })
    })

    it("#when called with opus #then maps to anthropic claude-opus-4-7 object", () => {
      expect(mapClaudeModelToOpenCode("opus")).toEqual({ providerID: SUPPORTED_PROVIDERS.ANTHROPIC, modelID: SUPPORTED_MODELS.CLAUDE_OPUS_4_7 })
    })

    it("#when called with haiku #then maps to anthropic claude-haiku-4-5 object", () => {
      expect(mapClaudeModelToOpenCode("haiku")).toEqual({ providerID: SUPPORTED_PROVIDERS.ANTHROPIC, modelID: SUPPORTED_MODELS.CLAUDE_HAIKU_4_5 })
    })

    it("#when called with Sonnet (capitalized) #then maps case-insensitively to object", () => {
      expect(mapClaudeModelToOpenCode("Sonnet")).toEqual({ providerID: SUPPORTED_PROVIDERS.ANTHROPIC, modelID: SUPPORTED_MODELS.CLAUDE_SONNET_4_6 })
    })
  })

  describe("#given inherit", () => {
    it("#when called with inherit #then returns undefined", () => {
      expect(mapClaudeModelToOpenCode("inherit")).toBeUndefined()
    })
  })

  describe("#given bare Claude model name", () => {
    it("#when called with claude-sonnet-4-5-20250514 #then adds anthropic object format", () => {
      expect(mapClaudeModelToOpenCode("claude-sonnet-4-5-20250514")).toEqual({ providerID: SUPPORTED_PROVIDERS.ANTHROPIC, modelID: "claude-sonnet-4-5-20250514" })
    })

    it("#when called with claude-opus-4-7 #then adds anthropic object format", () => {
      expect(mapClaudeModelToOpenCode(SUPPORTED_MODELS.CLAUDE_OPUS_4_7)).toEqual({ providerID: SUPPORTED_PROVIDERS.ANTHROPIC, modelID: SUPPORTED_MODELS.CLAUDE_OPUS_4_7 })
    })

    it("#when called with claude-haiku-4-5-20251001 #then adds anthropic object format", () => {
      expect(mapClaudeModelToOpenCode("claude-haiku-4-5-20251001")).toEqual({ providerID: SUPPORTED_PROVIDERS.ANTHROPIC, modelID: "claude-haiku-4-5-20251001" })
    })

    it("#when called with claude-3-5-sonnet-20241022 #then adds anthropic object format", () => {
      expect(mapClaudeModelToOpenCode("claude-3-5-sonnet-20241022")).toEqual({ providerID: SUPPORTED_PROVIDERS.ANTHROPIC, modelID: "claude-3-5-sonnet-20241022" })
    })
  })

  describe("#given model with dot version numbers", () => {
    it("#when called with claude-3.5-sonnet #then normalizes dots and returns object format", () => {
      expect(mapClaudeModelToOpenCode("claude-3.5-sonnet")).toEqual({ providerID: SUPPORTED_PROVIDERS.ANTHROPIC, modelID: "claude-3-5-sonnet" })
    })

    it("#when called with claude-3.5-sonnet-20241022 #then normalizes dots and returns object format", () => {
      expect(mapClaudeModelToOpenCode("claude-3.5-sonnet-20241022")).toEqual({ providerID: SUPPORTED_PROVIDERS.ANTHROPIC, modelID: "claude-3-5-sonnet-20241022" })
    })
  })

  describe("#given model already in provider/model format", () => {
    it("#when called with anthropic/claude-sonnet-4-6 #then splits into object format", () => {
      expect(mapClaudeModelToOpenCode("anthropic/claude-sonnet-4-6")).toEqual({ providerID: SUPPORTED_PROVIDERS.ANTHROPIC, modelID: SUPPORTED_MODELS.CLAUDE_SONNET_4_6 })
    })

    it("#when called with anthropic/claude-3.5-sonnet #then normalizes dots before splitting into object format", () => {
      expect(mapClaudeModelToOpenCode("anthropic/claude-3.5-sonnet")).toEqual({ providerID: SUPPORTED_PROVIDERS.ANTHROPIC, modelID: "claude-3-5-sonnet" })
    })

    it("#when called with openai/gpt-5.5 #then splits into object format", () => {
      expect(mapClaudeModelToOpenCode("openai/gpt-5.5")).toEqual({ providerID: SUPPORTED_PROVIDERS.OPENAI, modelID: SUPPORTED_MODELS.GPT_5_5 })
    })
  })

  describe("#given non-Claude bare model", () => {
    it("#when called with gpt-5.5 #then returns undefined", () => {
      expect(mapClaudeModelToOpenCode(SUPPORTED_MODELS.GPT_5_5)).toBeUndefined()
    })

    it("#when called with gemini-3-flash #then returns undefined", () => {
      expect(mapClaudeModelToOpenCode(SUPPORTED_MODELS.GEMINI_3_FLASH)).toBeUndefined()
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
      expect(mapClaudeModelToOpenCode("  claude-sonnet-4-6  ")).toEqual({ providerID: SUPPORTED_PROVIDERS.ANTHROPIC, modelID: SUPPORTED_MODELS.CLAUDE_SONNET_4_6 })
    })
  })

  describe("#given anthropicProvider override", () => {
    it("#when called with opus and custom provider #then maps to custom provider", () => {
      expect(mapClaudeModelToOpenCode("opus", "kiro")).toEqual({ providerID: "kiro", modelID: SUPPORTED_MODELS.CLAUDE_OPUS_4_7 })
    })

    it("#when called with sonnet and custom provider #then maps to custom provider", () => {
      expect(mapClaudeModelToOpenCode("sonnet", "kiro")).toEqual({ providerID: "kiro", modelID: SUPPORTED_MODELS.CLAUDE_SONNET_4_6 })
    })

    it("#when called with haiku and custom provider #then maps to custom provider", () => {
      expect(mapClaudeModelToOpenCode("haiku", "my-gateway")).toEqual({ providerID: "my-gateway", modelID: SUPPORTED_MODELS.CLAUDE_HAIKU_4_5 })
    })

    it("#when called with bare claude model and custom provider #then uses custom provider", () => {
      expect(mapClaudeModelToOpenCode("claude-opus-4-6", "kiro")).toEqual({ providerID: "kiro", modelID: "claude-opus-4-6" })
    })

    it("#when called with explicit provider/model format #then preserves original provider", () => {
      expect(mapClaudeModelToOpenCode("openai/gpt-5.5", "kiro")).toEqual({ providerID: SUPPORTED_PROVIDERS.OPENAI, modelID: SUPPORTED_MODELS.GPT_5_5 })
    })

    it("#when called without anthropicProvider #then defaults to anthropic", () => {
      expect(mapClaudeModelToOpenCode("opus")).toEqual({ providerID: SUPPORTED_PROVIDERS.ANTHROPIC, modelID: SUPPORTED_MODELS.CLAUDE_OPUS_4_7 })
    })
  })
})
