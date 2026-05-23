import { describe, expect, test } from "bun:test"
import { AgentOverridesSchema } from "./agent-overrides"

describe("AgentOverridesSchema", () => {
  test("preserves custom agent keys after parsing", () => {
    const input = {
      sisyphus: { model: "anthropic/claude-opus-4-6" },
      "technical-writer": {
        model: "anthropic/claude-sonnet-4-6",
        temperature: 0.3,
        prompt_append: "You are a technical writer.",
      },
    }

    const result = AgentOverridesSchema.safeParse(input)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.sisyphus).toBeDefined()
      expect(result.data["technical-writer"]).toBeDefined()
      expect(result.data["technical-writer"]?.model).toBe("anthropic/claude-sonnet-4-6")
      expect(result.data["technical-writer"]?.temperature).toBe(0.3)
    }
  })

  test("validates custom agent keys against AgentOverrideConfigSchema", () => {
    const input = {
      "custom-agent": {
        model: "provider/model",
        temperature: 5, // invalid: max is 2
      },
    }

    const result = AgentOverridesSchema.safeParse(input)

    expect(result.success).toBe(false)
  })

test('validates fallback_models in ultrawork scope', () => {
  const input = {
    sisyphus: {
      ultrawork: {
        model: 'anthropic/claude-opus-4-7',
        fallback_models: ['openai/gpt-5.3', 'google/gemini-3.1-pro'],
      },
    },
  }

  const result = AgentOverridesSchema.safeParse(input)
  expect(result.success).toBe(true)
  if (result.success) {
    const uw = result.data.sisyphus?.ultrawork
    expect(uw?.model).toBe('anthropic/claude-opus-4-7')
    expect(uw?.fallback_models).toEqual(['openai/gpt-5.3', 'google/gemini-3.1-pro'])
  }
})

test('validates fallback_models in compaction scope', () => {
  const input = {
    sisyphus: {
      compaction: {
        model: 'anthropic/claude-sonnet-4-6',
        fallback_models: ['openai/gpt-5.4-mini'],
      },
    },
  }

  const result = AgentOverridesSchema.safeParse(input)
  expect(result.success).toBe(true)
  if (result.success) {
    const cp = result.data.sisyphus?.compaction
    expect(cp?.model).toBe('anthropic/claude-sonnet-4-6')
    expect(cp?.fallback_models).toEqual(['openai/gpt-5.4-mini'])
  }
})

test('validates empty ultrawork scope without fallback_models', () => {
  const input = {
    sisyphus: {
      ultrawork: {},
    },
  }
  const result = AgentOverridesSchema.safeParse(input)
  expect(result.success).toBe(true)
  if (result.success) {
    const uw = result.data.sisyphus?.ultrawork
    expect(uw?.model).toBeUndefined()
    expect(uw?.variant).toBeUndefined()
    expect(uw?.fallback_models).toBeUndefined()
  }
})
})
