import { describe, test, expect } from "bun:test"
import { createBuiltinAgents } from "./utils"

describe("createBuiltinAgents with model overrides", () => {
  test("Sisyphus with default model has thinking config (Copilot Claude)", () => {
    // #given - no overrides

    // #when
    const agents = createBuiltinAgents()

    // #then - default is now github-copilot/claude-opus-4.5
    expect(agents.Sisyphus.model).toBe("github-copilot/claude-opus-4.5")
    expect(agents.Sisyphus.thinking).toEqual({ type: "enabled", budgetTokens: 32000 })
    expect(agents.Sisyphus.reasoningEffort).toBeUndefined()
  })

  test("Sisyphus with GPT model override has reasoningEffort, no thinking", () => {
    // #given
    const overrides = {
      Sisyphus: { model: "github-copilot/gpt-5.2" },
    }

    // #when
    const agents = createBuiltinAgents([], overrides)

    // #then
    expect(agents.Sisyphus.model).toBe("github-copilot/gpt-5.2")
    expect(agents.Sisyphus.reasoningEffort).toBe("medium")
    expect(agents.Sisyphus.thinking).toBeUndefined()
  })

  test("Sisyphus with systemDefaultModel GPT has reasoningEffort, no thinking", () => {
    // #given
    const systemDefaultModel = "openai/gpt-5.2"

    // #when
    const agents = createBuiltinAgents([], {}, undefined, systemDefaultModel)

    // #then
    expect(agents.Sisyphus.model).toBe("openai/gpt-5.2")
    expect(agents.Sisyphus.reasoningEffort).toBe("medium")
    expect(agents.Sisyphus.thinking).toBeUndefined()
  })

  test("Oracle with default model has reasoningEffort (Copilot GPT)", () => {
    // #given - no overrides

    // #when
    const agents = createBuiltinAgents()

    // #then - default is now github-copilot/gpt-5.2
    expect(agents.oracle.model).toBe("github-copilot/gpt-5.2")
    expect(agents.oracle.reasoningEffort).toBe("medium")
    expect(agents.oracle.textVerbosity).toBe("high")
    expect(agents.oracle.thinking).toBeUndefined()
  })

  test("Oracle with Claude model override has thinking, no reasoningEffort", () => {
    // #given
    const overrides = {
      oracle: { model: "anthropic/claude-sonnet-4" },
    }

    // #when
    const agents = createBuiltinAgents([], overrides)

    // #then
    expect(agents.oracle.model).toBe("anthropic/claude-sonnet-4")
    expect(agents.oracle.thinking).toEqual({ type: "enabled", budgetTokens: 32000 })
    expect(agents.oracle.reasoningEffort).toBeUndefined()
    expect(agents.oracle.textVerbosity).toBeUndefined()
  })

  test("non-model overrides are still applied after factory rebuild", () => {
    // #given
    const overrides = {
      Sisyphus: { model: "github-copilot/gpt-5.2", temperature: 0.5 },
    }

    // #when
    const agents = createBuiltinAgents([], overrides)

    // #then
    expect(agents.Sisyphus.model).toBe("github-copilot/gpt-5.2")
    expect(agents.Sisyphus.temperature).toBe(0.5)
  })

  test("Explore agent uses Copilot Haiku by default", () => {
    // #given - no overrides

    // #when
    const agents = createBuiltinAgents()

    // #then - default is now github-copilot/claude-haiku-4.5
    expect(agents.explore.model).toBe("github-copilot/claude-haiku-4.5")
  })

  test("Frontend agent uses Copilot Gemini by default", () => {
    // #given - no overrides

    // #when
    const agents = createBuiltinAgents()

    // #then - default is now github-copilot/gemini-3-pro-preview
    expect(agents["frontend-ui-ux-engineer"].model).toBe("github-copilot/gemini-3-pro-preview")
  })
})
