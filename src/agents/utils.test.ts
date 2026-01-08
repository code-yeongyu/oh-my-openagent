import { describe, test, expect } from "bun:test"
import { createBuiltinAgents, hasGeminiModelAgents, willHaveGeminiAgents } from "./utils"
import type { AgentConfig } from "@opencode-ai/sdk"

describe("createBuiltinAgents with model overrides", () => {
  test("Sisyphus with default model has thinking config", () => {
    // #given - no overrides

    // #when
    const agents = createBuiltinAgents()

    // #then
    expect(agents.Sisyphus.model).toBe("anthropic/claude-opus-4-5")
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

  test("Oracle with default model has reasoningEffort", () => {
    // #given - no overrides

    // #when
    const agents = createBuiltinAgents()

    // #then
    expect(agents.oracle.model).toBe("openai/gpt-5.2")
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
})

describe("hasGeminiModelAgents", () => {
  test("returns true when agents include google/gemini model", () => {
    // #given
    const agents: Record<string, AgentConfig> = {
      explore: { model: "anthropic/claude-sonnet-4" },
      "frontend-ui-ux-engineer": { model: "google/gemini-3-pro-preview" },
    }

    // #when
    const result = hasGeminiModelAgents(agents)

    // #then
    expect(result).toBe(true)
  })

  test("returns false when no agents use google/gemini model", () => {
    // #given
    const agents: Record<string, AgentConfig> = {
      explore: { model: "anthropic/claude-sonnet-4" },
      oracle: { model: "openai/gpt-5.2" },
    }

    // #when
    const result = hasGeminiModelAgents(agents)

    // #then
    expect(result).toBe(false)
  })

  test("returns false for empty agents object", () => {
    // #given
    const agents: Record<string, AgentConfig> = {}

    // #when
    const result = hasGeminiModelAgents(agents)

    // #then
    expect(result).toBe(false)
  })

  test("returns false when agent has no model defined", () => {
    // #given
    const agents: Record<string, AgentConfig> = {
      explore: { description: "Some agent without model" },
    }

    // #when
    const result = hasGeminiModelAgents(agents)

    // #then
    expect(result).toBe(false)
  })

  test("returns true for google/gemini-3-flash model", () => {
    // #given
    const agents: Record<string, AgentConfig> = {
      "multimodal-looker": { model: "google/gemini-3-flash" },
    }

    // #when
    const result = hasGeminiModelAgents(agents)

    // #then
    expect(result).toBe(true)
  })

  test("builtin agents with defaults include Gemini models", () => {
    // #given - default builtin agents
    const agents = createBuiltinAgents()

    // #when
    const result = hasGeminiModelAgents(agents)

    // #then - builtin agents include frontend-ui-ux-engineer, document-writer, multimodal-looker with Gemini
    expect(result).toBe(true)
  })

  test("builtin agents with Gemini agents disabled have no Gemini models", () => {
    // #given - disable all Gemini-using agents
    const agents = createBuiltinAgents([
      "frontend-ui-ux-engineer",
      "document-writer", 
      "multimodal-looker",
    ])

    // #when
    const result = hasGeminiModelAgents(agents)

    // #then - remaining agents (Sisyphus, oracle, librarian, explore) don't use Gemini
    expect(result).toBe(false)
  })
})

describe("willHaveGeminiAgents", () => {
  test("returns true with default config (no disabled agents)", () => {
    // #given - no disabled agents, no overrides

    // #when
    const result = willHaveGeminiAgents()

    // #then - default Gemini agents are active
    expect(result).toBe(true)
  })

  test("returns false when all Gemini agents are disabled", () => {
    // #given
    const disabledAgents = [
      "frontend-ui-ux-engineer",
      "document-writer",
      "multimodal-looker",
    ] as const

    // #when
    const result = willHaveGeminiAgents([...disabledAgents])

    // #then
    expect(result).toBe(false)
  })

  test("returns true when at least one Gemini agent is enabled", () => {
    // #given - only multimodal-looker disabled
    const disabledAgents = [
      "frontend-ui-ux-engineer",
      "document-writer",
    ] as const

    // #when
    const result = willHaveGeminiAgents([...disabledAgents])

    // #then - multimodal-looker is still active
    expect(result).toBe(true)
  })

  test("returns false when Gemini agent is overridden to non-Gemini model", () => {
    // #given
    const disabledAgents = [
      "document-writer",
      "multimodal-looker",
    ] as const
    const overrides = {
      "frontend-ui-ux-engineer": { model: "anthropic/claude-sonnet-4" },
    }

    // #when
    const result = willHaveGeminiAgents([...disabledAgents], overrides)

    // #then - only Gemini agent was overridden to Claude
    expect(result).toBe(false)
  })

  test("returns true when non-Gemini agent is overridden to Gemini model", () => {
    // #given - disable all default Gemini agents but override explore to Gemini
    const disabledAgents = [
      "frontend-ui-ux-engineer",
      "document-writer",
      "multimodal-looker",
    ] as const
    const overrides = {
      explore: { model: "google/gemini-3-flash" },
    }

    // #when
    const result = willHaveGeminiAgents([...disabledAgents], overrides)

    // #then - explore is now using Gemini
    expect(result).toBe(true)
  })

  test("returns false when overridden Gemini agent is also disabled", () => {
    // #given - explore overridden to Gemini but also disabled
    const disabledAgents = [
      "frontend-ui-ux-engineer",
      "document-writer",
      "multimodal-looker",
      "explore",
    ] as const
    const overrides = {
      explore: { model: "google/gemini-3-flash" },
    }

    // #when
    const result = willHaveGeminiAgents([...disabledAgents], overrides)

    // #then - explore is disabled so its override doesn't count
    expect(result).toBe(false)
  })
})
