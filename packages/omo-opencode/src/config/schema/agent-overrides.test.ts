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

  test("rejects agent depth above supported depth", () => {
    expect(AgentOverridesSchema.safeParse({ sisyphus: { maxDepth: 3 } }).success).toBe(false)
  })
})
