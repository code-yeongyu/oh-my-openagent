import { describe, expect, test } from "bun:test"
import type { AgentConfig } from "@opencode-ai/sdk"
import { applyModelThinkingConfig } from "./model-thinking-config"

const BASE_CONFIG: AgentConfig = {
  name: "test-agent",
  description: "test",
  model: "anthropic/claude-opus-4-6",
  temperature: 0.1,
}

describe("applyModelThinkingConfig", () => {
  describe("#given a GPT model", () => {
    test("#then returns reasoningEffort medium", () => {
      const result = applyModelThinkingConfig(BASE_CONFIG, "gpt-5.2")
      expect(result).toEqual({ ...BASE_CONFIG, reasoningEffort: "medium" })
    })

    test("#then returns reasoningEffort medium for openai-prefixed model", () => {
      const result = applyModelThinkingConfig(BASE_CONFIG, "openai/gpt-5.2")
      expect(result).toEqual({ ...BASE_CONFIG, reasoningEffort: "medium" })
    })
  })

  describe("#given an Anthropic model", () => {
    test("#then returns thinking config with budgetTokens 32000", () => {
      const result = applyModelThinkingConfig(BASE_CONFIG, "anthropic/claude-opus-4-6")
      expect(result).toEqual({
        ...BASE_CONFIG,
        thinking: { type: "enabled", budgetTokens: 32000 },
      })
    })
  })

  describe("#given a Google model", () => {
    test("#then returns base config unchanged", () => {
      const result = applyModelThinkingConfig(BASE_CONFIG, "google/gemini-3-pro")
      expect(result).toBe(BASE_CONFIG)
    })
  })

  describe("#given a Kimi model", () => {
    test("#then returns base config unchanged", () => {
      const result = applyModelThinkingConfig(BASE_CONFIG, "kimi/kimi-k2.5")
      expect(result).toBe(BASE_CONFIG)
    })
  })

  describe("#given a model with no provider prefix", () => {
    test("#then returns base config unchanged for non-GPT model", () => {
      const result = applyModelThinkingConfig(BASE_CONFIG, "gemini-3-pro")
      expect(result).toBe(BASE_CONFIG)
    })
  })

  describe("#given a Claude model through a non-Anthropic provider", () => {
    test("#then returns thinking config for github-copilot/claude-opus-4-6", () => {
      const result = applyModelThinkingConfig(BASE_CONFIG, "github-copilot/claude-opus-4-6")
      expect(result).toEqual({
        ...BASE_CONFIG,
        thinking: { type: "enabled", budgetTokens: 32000 },
      })
    })

    test("#then returns thinking config for opencode/claude-opus-4-6", () => {
      const result = applyModelThinkingConfig(BASE_CONFIG, "opencode/claude-opus-4-6")
      expect(result).toEqual({
        ...BASE_CONFIG,
        thinking: { type: "enabled", budgetTokens: 32000 },
      })
    })

    test("#then returns thinking config for opencode/claude-sonnet-4-6", () => {
      const result = applyModelThinkingConfig(BASE_CONFIG, "opencode/claude-sonnet-4-6")
      expect(result).toEqual({
        ...BASE_CONFIG,
        thinking: { type: "enabled", budgetTokens: 32000 },
      })
    })
  })
})
