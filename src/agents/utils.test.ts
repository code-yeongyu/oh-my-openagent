import { describe, test, expect } from "bun:test"
import { createBuiltinAgents } from "./utils"
import { CODE_REVIEWER_PROMPTS } from "./code-reviewer"

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

describe("createBuiltinAgents with code-reviewer overrides", () => {
  test("code-reviewer with code_reviewer_mode override uses correct prompt", () => {
    // #given
    const overrides = {
      "code-reviewer": { code_reviewer_mode: "silent_failure_hunter" as const },
    }

    // #when
    const agents = createBuiltinAgents([], overrides)

    // #then
    expect(agents["code-reviewer"].prompt).toBe(CODE_REVIEWER_PROMPTS.silent_failure_hunter)
  })

  test("code-reviewer with invalid mode in config falls back to general", () => {
    // #given
    const overrides = {
      "code-reviewer": { code_reviewer_mode: "invalid_mode" as any },
    }

    // #when
    const agents = createBuiltinAgents([], overrides)

    // #then
    expect(agents["code-reviewer"].prompt).toBe(CODE_REVIEWER_PROMPTS.general)
  })

  test("code-reviewer receives environment context when directory is provided", () => {
    // #given
    const directory = "/test/project"

    // #when
    const agents = createBuiltinAgents([], {}, directory)

    // #then
    expect(agents["code-reviewer"].prompt).toContain("Working directory:")
    expect(agents["code-reviewer"].prompt).toContain(directory)
  })

  test("explore receives environment context when directory is provided", () => {
    // #given
    const directory = "/test/project"

    // #when
    const agents = createBuiltinAgents([], {}, directory)

    // #then
    expect(agents.explore.prompt).toContain("Working directory:")
    expect(agents.explore.prompt).toContain(directory)
  })

  test("environment context is preserved after prompt override", () => {
    // #given
    const directory = "/test/project"
    const overrides = {
      "code-reviewer": { prompt: "Custom prompt for review." },
    }

    // #when
    const agents = createBuiltinAgents([], overrides, directory)

    // #then - context should be appended AFTER override
    expect(agents["code-reviewer"].prompt).toContain("Custom prompt for review.")
    expect(agents["code-reviewer"].prompt).toContain("Working directory:")
    expect(agents["code-reviewer"].prompt).toContain(directory)
  })
})
