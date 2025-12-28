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

describe("createBuiltinAgents with disabledAgents", () => {
  test("disabled agents are excluded from result", () => {
    // #given
    const disabledAgents = ["oracle", "explore"] as const

    // #when
    const agents = createBuiltinAgents([...disabledAgents])

    // #then
    expect(agents.oracle).toBeUndefined()
    expect(agents.explore).toBeUndefined()
    expect(agents.Sisyphus).toBeDefined()
    expect(agents["code-reviewer"]).toBeDefined()
    expect(agents.librarian).toBeDefined()
  })

  test("all agents present when no agents disabled", () => {
    // #given - no disabled agents

    // #when
    const agents = createBuiltinAgents([])

    // #then
    expect(Object.keys(agents)).toContain("Sisyphus")
    expect(Object.keys(agents)).toContain("oracle")
    expect(Object.keys(agents)).toContain("explore")
    expect(Object.keys(agents)).toContain("code-reviewer")
  })
})

describe("createBuiltinAgents with prompt_append", () => {
  test("prompt_append appends to existing prompt", () => {
    // #given
    const overrides = {
      "code-reviewer": { prompt_append: "Additional instructions here." },
    }

    // #when
    const agents = createBuiltinAgents([], overrides)

    // #then
    expect(agents["code-reviewer"].prompt).toContain("Additional instructions here.")
    expect(agents["code-reviewer"].prompt).toContain("expert code reviewer")
  })

  test("prompt_append works even when prompt is overridden", () => {
    // #given
    const overrides = {
      "code-reviewer": { 
        prompt: "Custom base prompt.",
        prompt_append: "Appended text." 
      },
    }

    // #when
    const agents = createBuiltinAgents([], overrides)

    // #then
    expect(agents["code-reviewer"].prompt).toBe("Custom base prompt.\nAppended text.")
  })
})

describe("createBuiltinAgents tool override behavior", () => {
  test("tools can be re-enabled via overrides", () => {
    // #given
    const overrides = {
      "code-reviewer": { tools: { edit: true, write: false, task: false, background_task: false } },
    }

    // #when
    const agents = createBuiltinAgents([], overrides)

    // #then
    expect(agents["code-reviewer"].tools).toEqual({
      edit: true,
      write: false,
      task: false,
      background_task: false,
    })
  })
})

describe("isCodeReviewerOverride behavior", () => {
  test("non-code-reviewer agents do not have code_reviewer_mode applied", () => {
    // #given - oracle override with code_reviewer_mode (invalid but possible via config)
    const overrides = {
      oracle: { code_reviewer_mode: "silent_failure_hunter" } as any,
    }

    // #when
    const agents = createBuiltinAgents([], overrides)

    // #then - oracle should NOT use code-reviewer prompt
    expect(agents.oracle.prompt).not.toContain("silent failure")
  })
})
