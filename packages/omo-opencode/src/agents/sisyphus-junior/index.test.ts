import { describe, expect, test } from "bun:test"
import {
  createSisyphusJuniorAgentWithOverrides,
  SISYPHUS_JUNIOR_DEFAULTS,
  getSisyphusJuniorPromptSource,
  buildSisyphusJuniorPrompt,
} from "./index"

describe("createSisyphusJuniorAgentWithOverrides", () => {
  describe("honored fields", () => {
    test("applies model override", () => {
      // given
      const override = { model: "openai/gpt-5.4" }

      // when
      const result = createSisyphusJuniorAgentWithOverrides(override)

      // then
      expect(result.model).toBe("openai/gpt-5.4")
    })

    test("applies temperature override", () => {
      // given
      const override = { temperature: 0.5 }

      // when
      const result = createSisyphusJuniorAgentWithOverrides(override)

      // then
      expect(result.temperature).toBe(0.5)
    })

    test("applies top_p override", () => {
      // given
      const override = { top_p: 0.9 }

      // when
      const result = createSisyphusJuniorAgentWithOverrides(override)

      // then
      expect(result.top_p).toBe(0.9)
    })

    test("applies description override", () => {
      // given
      const override = { description: "SENTINEL_DESCRIPTION_OVERRIDE" }

      // when
      const result = createSisyphusJuniorAgentWithOverrides(override)

      // then
      expect(result.description).toBe("SENTINEL_DESCRIPTION_OVERRIDE")
    })

    test("applies color override", () => {
      // given
      const override = { color: "#FF0000" }

      // when
      const result = createSisyphusJuniorAgentWithOverrides(override)

      // then
      expect(result.color).toBe("#FF0000")
    })

    test("appends prompt_append to base prompt", () => {
      // given
      const override = { prompt_append: "SENTINEL_APPEND_CONTENT" }

      // when
      const result = createSisyphusJuniorAgentWithOverrides(override)

      // then
      expect(result.prompt).toContain("SENTINEL_APPEND_CONTENT")
    })
  })

  describe("defaults", () => {
    test("uses default model when no override", () => {
      // given
      const override = {}

      // when
      const result = createSisyphusJuniorAgentWithOverrides(override)

      // then
      expect(SISYPHUS_JUNIOR_DEFAULTS.model).toBe("anthropic/claude-sonnet-5")
      expect(result.model).toBe(SISYPHUS_JUNIOR_DEFAULTS.model)
    })

    test("uses default temperature when no override", () => {
      // given
      const override = {}

      // when
      const result = createSisyphusJuniorAgentWithOverrides(override)

      // then
      expect(result.temperature).toBe(SISYPHUS_JUNIOR_DEFAULTS.temperature)
    })
  })

  describe("disable semantics", () => {
    test("disable: true causes override block to be ignored", () => {
      // given
      const override = {
        disable: true,
        model: "openai/gpt-5.4",
        temperature: 0.9,
      }

      // when
      const result = createSisyphusJuniorAgentWithOverrides(override)

      // then - defaults should be used, not the overrides
      expect(result.model).toBe(SISYPHUS_JUNIOR_DEFAULTS.model)
      expect(result.temperature).toBe(SISYPHUS_JUNIOR_DEFAULTS.temperature)
    })
  })

  describe("constrained fields", () => {
    test("mode is forced to subagent", () => {
      // given
      const override = { mode: "primary" as const }

      // when
      const result = createSisyphusJuniorAgentWithOverrides(override)

      // then
      expect(result.mode).toBe("subagent")
    })

    test("prompt override is ignored in favor of the routed prompt builder", () => {
      // given
      const override = { prompt: "Completely new prompt that replaces everything" }

      // when
      const result = createSisyphusJuniorAgentWithOverrides(override)

      // then
      expect(result.prompt).toBe(buildSisyphusJuniorPrompt(SISYPHUS_JUNIOR_DEFAULTS.model, false))
    })
  })

  describe("reasoning configuration", () => {
    test("#given GPT model #when agent is created #then uses reasoningEffort", () => {
      // given
      const override = { model: "openai/gpt-5.4" }

      // when
      const result = createSisyphusJuniorAgentWithOverrides(override)

      // then
      expect(result.reasoningEffort).toBe("medium")
      expect(result.thinking).toBeUndefined()
    })

    test("#given GPT model with variant override #when agent is created #then respects user variant", () => {
      const override = {
        model: "openai/gpt-5.6-sol",
        variant: "xhigh",
        reasoningEffort: "xhigh" as const,
      }

      const result = createSisyphusJuniorAgentWithOverrides(override)

      expect(result.variant).toBe("xhigh")
      expect(result.reasoningEffort).toBe("xhigh")
    })

    test("#given GPT model with reasoningEffort override only #when agent is created #then honors reasoningEffort without injecting variant", () => {
      // given
      const override = { model: "openai/gpt-5.6-sol", reasoningEffort: "high" as const }

      // when
      const result = createSisyphusJuniorAgentWithOverrides(override)

      // then
      expect(result.reasoningEffort).toBe("high")
      expect(result.variant).toBeUndefined()
    })

    test("#given GPT model with variant override only #when agent is created #then keeps default reasoningEffort", () => {
      // given
      const override = { model: "openai/gpt-5.6-sol", variant: "xhigh" }

      // when
      const result = createSisyphusJuniorAgentWithOverrides(override)

      // then
      expect(result.variant).toBe("xhigh")
      expect(result.reasoningEffort).toBe("medium")
    })

    test("#given GPT model with distinct variant and reasoningEffort #when agent is created #then applies each independently", () => {
      // given
      const override = { model: "openai/gpt-5.6-sol", variant: "xhigh", reasoningEffort: "low" as const }

      // when
      const result = createSisyphusJuniorAgentWithOverrides(override)

      // then
      expect(result.variant).toBe("xhigh")
      expect(result.reasoningEffort).toBe("low")
    })

    test("#given Claude opus-4.7+ model with variant override #when agent is created #then honors variant and lets core derive effort", () => {
      // given
      const override = { model: "anthropic/claude-opus-4-7", variant: "max" }

      // when
      const result = createSisyphusJuniorAgentWithOverrides(override)

      // then
      expect(result.variant).toBe("max")
      expect(result.thinking).toBeUndefined()
      expect(result.reasoningEffort).toBeUndefined()
    })

    test("#given Claude model #when agent is created #then injects thinking", () => {
      // given
      const override = { model: "anthropic/claude-sonnet-5" }

      // when
      const result = createSisyphusJuniorAgentWithOverrides(override)

      // then
      expect(result.reasoningEffort).toBeUndefined()
      expect(result.thinking).toEqual({ type: "enabled", budgetTokens: 32000 })
    })

    test("#given GLM reasoning model #when agent is created #then skips injected thinking", () => {
      // given
      const override = { model: "z-ai/glm-5" }

      // when
      const result = createSisyphusJuniorAgentWithOverrides(override)

      // then
      expect(result.reasoningEffort).toBeUndefined()
      expect(result.thinking).toBeUndefined()
    })
  })

  describe("tool safety (task blocked, call_omo_agent allowed)", () => {
    test("task remains blocked, call_omo_agent is allowed via tools format", () => {
      // given
      const override = {
        tools: {
          task: true,
          call_omo_agent: true,
          read: true,
        },
      }

      // when
      const result = createSisyphusJuniorAgentWithOverrides(override)

      // then
      const tools = result.tools as Record<string, boolean> | undefined
      const permission = result.permission as Record<string, string> | undefined
      if (tools) {
        expect(tools.task).toBe(false)
        // call_omo_agent is NOW ALLOWED for subagents to spawn explore/librarian
        expect(tools.call_omo_agent).toBe(true)
        expect(tools.read).toBe(true)
      }
      if (permission) {
        expect(permission.task).toBe("deny")
        // call_omo_agent is NOW ALLOWED for subagents to spawn explore/librarian
        expect(permission.call_omo_agent).toBe("allow")
      }
    })

    test("task remains blocked when using permission format override", () => {
      // given
      const override = {
        permission: {
          task: "allow",
          call_omo_agent: "allow",
          read: "allow",
        },
      } as { permission: Record<string, string> }

      // when
      const result = createSisyphusJuniorAgentWithOverrides(override as Parameters<typeof createSisyphusJuniorAgentWithOverrides>[0])

      // then - task blocked, but call_omo_agent allowed for explore/librarian spawning
      const tools = result.tools as Record<string, boolean> | undefined
      const permission = result.permission as Record<string, string> | undefined
      if (tools) {
        expect(tools.task).toBe(false)
        expect(tools.call_omo_agent).toBe(true)
      }
      if (permission) {
        expect(permission.task).toBe("deny")
        expect(permission.call_omo_agent).toBe("allow")
      }
    })

    test("tools override migrates boolean tools to permission (issue #5193)", () => {
      // given
      const override = {
        tools: { grep: false, write: false, read: true } as Record<string, boolean>,
      }
      // when
      const result = createSisyphusJuniorAgentWithOverrides(override as Parameters<typeof createSisyphusJuniorAgentWithOverrides>[0])
      // then
      const permission = result.permission as Record<string, string>
      expect(permission.grep).toBe("deny")
      expect(permission.write).toBe("deny")
      expect(permission.read).toBe("allow")
    })

    test("permission override with MCP tool keys passes through (issue #5193)", () => {
      // given
      const override = {
        permission: {
          "mcp__context7__resolve-library-id": "allow",
          grep: "deny",
        } as Record<string, string>,
      }
      // when
      const result = createSisyphusJuniorAgentWithOverrides(override as Parameters<typeof createSisyphusJuniorAgentWithOverrides>[0])
      // then
      const permission = result.permission as Record<string, string>
      expect(permission["mcp__context7__resolve-library-id"]).toBe("allow")
      expect(permission.grep).toBe("deny")
      // task must remain denied (hardcoded BLOCKED_TOOLS)
      expect(permission.task).toBe("deny")
    })
  })

  describe("useTaskSystem integration", () => {
    test("useTaskSystem=true wires the task tool contract for Claude", () => {
      //#given
      const override = { model: "anthropic/claude-sonnet-5" }

      //#when
      const result = createSisyphusJuniorAgentWithOverrides(override, undefined, true)

      //#then
      expect(result.prompt).toContain("task_create")
      expect(result.prompt).toContain("task_update")
      expect(result.prompt).not.toContain("todowrite")
    })

    test("useTaskSystem=true wires the task tool contract for GPT", () => {
      //#given
      const override = { model: "openai/gpt-5.4" }

      //#when
      const result = createSisyphusJuniorAgentWithOverrides(override, undefined, true)

      //#then
      expect(result.prompt).toContain("task_create")
      expect(result.prompt).not.toContain("todowrite")
    })

    test("useTaskSystem=false (default) wires the todo tool contract", () => {
      //#given
      const override = {}

      //#when
      const result = createSisyphusJuniorAgentWithOverrides(override)

      //#then
      expect(result.prompt).toContain("todowrite")
      expect(result.prompt).not.toContain("task_create")
    })

    test("useTaskSystem=false uses todowrite instead of task_create for Claude", () => {
      //#given
      const override = { model: "anthropic/claude-sonnet-5" }

      //#when
      const result = createSisyphusJuniorAgentWithOverrides(override, undefined, false)

      //#then
      expect(result.prompt).toContain("todowrite")
      expect(result.prompt).not.toContain("task_create")
    })
  })

  describe("prompt composition", () => {
    test("no variant force-denies apply_patch", () => {
      // given
      const gpt54Override = { model: "openai/gpt-5.4" }
      const gpt55Override = { model: "openai/gpt-5.5" }
      const gptGenericOverride = { model: "openai/gpt-4o" }
      const claudeOverride = { model: "anthropic/claude-sonnet-5" }

      // when
      const gpt54Result = createSisyphusJuniorAgentWithOverrides(gpt54Override)
      const gpt55Result = createSisyphusJuniorAgentWithOverrides(gpt55Override)
      const gptGenericResult = createSisyphusJuniorAgentWithOverrides(gptGenericOverride)
      const claudeResult = createSisyphusJuniorAgentWithOverrides(claudeOverride)

      // then
      expect(gpt54Result.permission ?? {}).not.toHaveProperty("apply_patch")
      expect(gpt55Result.permission ?? {}).not.toHaveProperty("apply_patch")
      expect(gptGenericResult.permission ?? {}).not.toHaveProperty("apply_patch")
      expect(claudeResult.permission ?? {}).not.toHaveProperty("apply_patch")
    })

    test("prompt_append is appended after the base prompt", () => {
      // given
      const override = { prompt_append: "SENTINEL_APPEND_CONTENT" }

      // when
      const result = createSisyphusJuniorAgentWithOverrides(override)

      // then - the appended content lands at the end of the composed prompt
      const prompt = result.prompt ?? ""
      expect(prompt).toContain("SENTINEL_APPEND_CONTENT")
      expect(prompt.endsWith("SENTINEL_APPEND_CONTENT")).toBe(true)
    })
  })
})

describe("getSisyphusJuniorPromptSource", () => {
  test("returns 'kimi-k2' for kimi-k2-6 model", () => {
    // given
    const model = "moonshotai/Kimi-K2.6"

    // when
    const source = getSisyphusJuniorPromptSource(model)

    // then
    expect(source).toBe("kimi-k2")
  })

  test("returns 'kimi-k2' for kimi-k2-5 model", () => {
    // given
    const model = "kimi-k2.5"

    // when
    const source = getSisyphusJuniorPromptSource(model)

    // then
    expect(source).toBe("kimi-k2")
  })

  test("returns 'kimi-k2' for k2p6 shorthand", () => {
    // given
    const model = "moonshot/k2p6"

    // when
    const source = getSisyphusJuniorPromptSource(model)

    // then
    expect(source).toBe("kimi-k2")
  })

  test("returns 'kimi-k3' for kimi-k3 model, not 'kimi-k2-7' or 'kimi-k2'", () => {
    // given
    const model = "opencode-go/kimi-k3"

    // when
    const source = getSisyphusJuniorPromptSource(model)

    // then
    expect(source).toBe("kimi-k3")
  })

  test("returns 'kimi-k3' for k3p1 shorthand", () => {
    // given
    const model = "kimi-for-coding/k3p1"

    // when
    const source = getSisyphusJuniorPromptSource(model)

    // then
    expect(source).toBe("kimi-k3")
  })

  test("returns 'kimi-k2-7' for kimi-k2.7 model, not 'kimi-k2'", () => {
    // given
    const model = "opencode-go/kimi-k2.7"

    // when
    const source = getSisyphusJuniorPromptSource(model)

    // then
    expect(source).toBe("kimi-k2-7")
  })

  test("returns 'kimi-k2-7' for k2p7 shorthand", () => {
    // given
    const model = "kimi-for-coding/k2p7"

    // when
    const source = getSisyphusJuniorPromptSource(model)

    // then
    expect(source).toBe("kimi-k2-7")
  })

  test("returns 'gpt-5-4' for GPT 5.4 models", () => {
    // given
    const model = "openai/gpt-5.4"

    // when
    const source = getSisyphusJuniorPromptSource(model)

    // then
    expect(source).toBe("gpt-5-4")
  })

  test("returns 'gpt-5-4' for GitHub Copilot GPT 5.4", () => {
    // given
    const model = "github-copilot/gpt-5.4"

    // when
    const source = getSisyphusJuniorPromptSource(model)

    // then
    expect(source).toBe("gpt-5-4")
  })

  test("returns 'gpt-5-5' for GPT 5.5 models", () => {
    // given
    const model = "openai/gpt-5.5"

    // when
    const source = getSisyphusJuniorPromptSource(model)

    // then
    expect(source).toBe("gpt-5-5")
  })

  test("returns 'gpt-5-5' for GitHub Copilot GPT 5.5", () => {
    // given
    const model = "github-copilot/gpt-5.5"

    // when
    const source = getSisyphusJuniorPromptSource(model)

    // then
    expect(source).toBe("gpt-5-5")
  })

  test("returns 'gpt-5-5' for GPT 5.6 models", () => {
    // given
    const model = "openai/gpt-5.6-sol"

    // when
    const source = getSisyphusJuniorPromptSource(model)

    // then
    expect(source).toBe("gpt-5-5")
  })

  test("returns 'gpt' for generic GPT models", () => {
    // given
    const model = "openai/gpt-4o"

    // when
    const source = getSisyphusJuniorPromptSource(model)

    // then
    expect(source).toBe("gpt")
  })

  test("returns 'gpt' for GitHub Copilot generic GPT models", () => {
    // given
    const model = "github-copilot/gpt-4o"

    // when
    const source = getSisyphusJuniorPromptSource(model)

    // then
    expect(source).toBe("gpt")
  })

  test("returns 'default' for Claude models", () => {
    // given
    const model = "anthropic/claude-sonnet-5"

    // when
    const source = getSisyphusJuniorPromptSource(model)

    // then
    expect(source).toBe("default")
  })

  test("returns 'default' for undefined model", () => {
    // given
    const model = undefined

    // when
    const source = getSisyphusJuniorPromptSource(model)

    // then
    expect(source).toBe("default")
  })
})

describe("buildSisyphusJuniorPrompt", () => {
  test("useTaskSystem=true wires the task tool contract for GPT 5.4", () => {
    // given
    const model = "openai/gpt-5.4"

    // when
    const prompt = buildSisyphusJuniorPrompt(model, true)

    // then
    expect(prompt).toContain("task_create")
    expect(prompt).not.toContain("todowrite")
  })

  test("useTaskSystem=true wires the task tool contract for GPT 5.5", () => {
    // given
    const model = "openai/gpt-5.5"

    // when
    const prompt = buildSisyphusJuniorPrompt(model, true)

    // then
    expect(prompt).toContain("task_create")
    expect(prompt).not.toContain("todowrite")
  })

  test("useTaskSystem=false wires the todo tool contract for Claude", () => {
    // given
    const model = "anthropic/claude-sonnet-5"

    // when
    const prompt = buildSisyphusJuniorPrompt(model, false)

    // then
    expect(prompt).toContain("todowrite")
    expect(prompt).not.toContain("task_create")
  })

  test("routes each model id to its prompt source", () => {
    // given
    const cases = [
      ["opencode-go/kimi-k3", "kimi-k3"],
      ["opencode-go/kimi-k2.7", "kimi-k2-7"],
      ["opencode-go/kimi-k2.6", "kimi-k2"],
      ["openai/gpt-5.6-sol", "gpt-5-5"],
      ["openai/gpt-5.5", "gpt-5-5"],
      ["openai/gpt-5.4", "gpt-5-4"],
      ["openai/gpt-4o", "gpt"],
      ["google/gemini-3.1-pro", "gemini"],
      ["zai/glm-5.2", "glm-5-2"],
      ["anthropic/claude-sonnet-5", "default"],
    ] as const

    // when / then
    expect(cases.map(([model]) => getSisyphusJuniorPromptSource(model))).toEqual(
      cases.map(([, source]) => source),
    )
  })
})
