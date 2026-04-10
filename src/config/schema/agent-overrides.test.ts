const { describe, test, expect } = require("bun:test")
const { AgentOverridesSchema } = require("./agent-overrides")

describe("AgentOverridesSchema", () => {
  test("should preserve custom agent keys after parsing (#3229)", () => {
    //#given
    const input = {
      sisyphus: { model: "anthropic/claude-opus-4-6" },
      "technical-writer": {
        model: "anthropic/claude-sonnet-4-6",
        prompt_append: "You are a technical writer.",
      },
      scribe: {
        model: "gitlab/duo-chat-sonnet-4-6",
        description: "Documentation agent",
      },
    }

    //#when
    const parsed = AgentOverridesSchema.parse(input)

    //#then
    expect(parsed.sisyphus).toBeDefined()
    expect(parsed["technical-writer"]).toBeDefined()
    expect(parsed["technical-writer"]?.model).toBe("anthropic/claude-sonnet-4-6")
    expect(parsed.scribe).toBeDefined()
    expect(parsed.scribe?.description).toBe("Documentation agent")
  })

  test("should still validate custom agent keys against AgentOverrideConfigSchema", () => {
    //#given
    const input = {
      "custom-agent": {
        model: "provider/model",
        temperature: 5, // invalid: max is 2
      },
    }

    //#when & then
    expect(() => AgentOverridesSchema.parse(input)).toThrow()
  })
})

export {}
