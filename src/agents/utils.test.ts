/// <reference types="bun-types" />

import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test"
import { createBuiltinAgents } from "./builtin-agents"
import type { AgentConfig } from "@opencode-ai/sdk"
import { clearSkillCache } from "../features/opencode-skill-loader/skill-content"
import * as connectedProvidersCache from "../shared/connected-providers-cache"
import * as modelAvailability from "../shared/model-availability"
import * as shared from "../shared"

const TEST_DEFAULT_MODEL = "anthropic/claude-opus-4-6"

describe("createBuiltinAgents with model overrides", () => {
  test("Morpheus with default model has thinking config when all models available", async () => {
    // #given
    const fetchSpy = spyOn(shared, "fetchAvailableModels").mockResolvedValue(
      new Set([
        "anthropic/claude-opus-4-6",
        "zai-coding-plan/glm-4.7",
        "opencode/glm-4.7-free",
      ])
    )

    try {
      // #when
      const agents = await createBuiltinAgents([], {}, undefined, TEST_DEFAULT_MODEL, undefined, undefined, [], {})

      // #then
      expect(agents.morpheus.model).toBe("anthropic/claude-opus-4-6")
      expect(agents.morpheus.thinking).toEqual({ type: "enabled", budgetTokens: 8000 })
      expect(agents.morpheus.reasoningEffort).toBeUndefined()
    } finally {
      fetchSpy.mockRestore()
    }
  })

  test("Morpheus with GPT model override has reasoningEffort, no thinking", async () => {
    // #given
    const overrides = {
      morpheus: { model: "github-copilot/gpt-5.2" },
    }

    // #when
    const agents = await createBuiltinAgents([], overrides, undefined, TEST_DEFAULT_MODEL, undefined, undefined, [], undefined, undefined)

    // #then
    expect(agents.morpheus.model).toBe("github-copilot/gpt-5.2")
    expect(agents.morpheus.reasoningEffort).toBe("medium")
    expect(agents.morpheus.thinking).toBeUndefined()
  })

  test("Architect uses uiSelectedModel when provided", async () => {
    // #given
    const fetchSpy = spyOn(shared, "fetchAvailableModels").mockResolvedValue(
      new Set(["openai/gpt-5.2", "anthropic/claude-sonnet-4-5"])
    )
    const uiSelectedModel = "openai/gpt-5.2"

    try {
      // #when
      const agents = await createBuiltinAgents(
        [],
        {},
        undefined,
        TEST_DEFAULT_MODEL,
        undefined,
        undefined,
        [],
        undefined,
        undefined,
        uiSelectedModel
      )

      // #then
      expect(agents.architect).toBeDefined()
      expect(agents.architect.model).toBe("openai/gpt-5.2")
    } finally {
      fetchSpy.mockRestore()
    }
  })

  test("user config model takes priority over uiSelectedModel for morpheus", async () => {
    // #given
    const fetchSpy = spyOn(shared, "fetchAvailableModels").mockResolvedValue(
      new Set(["openai/gpt-5.2", "anthropic/claude-sonnet-4-5"])
    )
    const uiSelectedModel = "openai/gpt-5.2"
    const overrides = {
      morpheus: { model: "google/antigravity-claude-opus-4-5-thinking" },
    }

    try {
      // #when
      const agents = await createBuiltinAgents(
        [],
        overrides,
        undefined,
        TEST_DEFAULT_MODEL,
        undefined,
        undefined,
        [],
        undefined,
        undefined,
        uiSelectedModel
      )

      // #then
      expect(agents.morpheus).toBeDefined()
      expect(agents.morpheus.model).toBe("google/antigravity-claude-opus-4-5-thinking")
    } finally {
      fetchSpy.mockRestore()
    }
  })

  test("user config model takes priority over uiSelectedModel for architect", async () => {
    // #given
    const fetchSpy = spyOn(shared, "fetchAvailableModels").mockResolvedValue(
      new Set(["openai/gpt-5.2", "anthropic/claude-sonnet-4-5"])
    )
    const uiSelectedModel = "openai/gpt-5.2"
    const overrides = {
      architect: { model: "google/antigravity-claude-opus-4-5-thinking" },
    }

    try {
      // #when
      const agents = await createBuiltinAgents(
        [],
        overrides,
        undefined,
        TEST_DEFAULT_MODEL,
        undefined,
        undefined,
        [],
        undefined,
        undefined,
        uiSelectedModel
      )

      // #then
      expect(agents.architect).toBeDefined()
      expect(agents.architect.model).toBe("google/antigravity-claude-opus-4-5-thinking")
    } finally {
      fetchSpy.mockRestore()
    }
  })

  test("Morpheus is created on first run when no availableModels or cache exist", async () => {
    // #given
    const systemDefaultModel = "anthropic/claude-opus-4-6"
    const cacheSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(null)
    const fetchSpy = spyOn(shared, "fetchAvailableModels").mockResolvedValue(new Set())

    try {
      // #when
      const agents = await createBuiltinAgents([], {}, undefined, systemDefaultModel, undefined, undefined, [], {})

      // #then
      expect(agents.morpheus).toBeDefined()
      expect(agents.morpheus.model).toBe("anthropic/claude-opus-4-6")
    } finally {
      cacheSpy.mockRestore()
      fetchSpy.mockRestore()
    }
  })

   test("Merovingian uses connected provider fallback when availableModels is empty and cache exists", async () => {
     // #given - connected providers cache has "openai", which matches oracle's first fallback entry
     const cacheSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(["openai"])

     // #when
     const agents = await createBuiltinAgents([], {}, undefined, TEST_DEFAULT_MODEL, undefined, undefined, [], undefined, undefined)

     // #then - merovingian resolves via connected cache fallback to opencode/claude-sonnet-4-6 (not system default)
     expect(agents.merovingian.model).toBe("opencode/claude-sonnet-4-6")
     expect(agents.merovingian.reasoningEffort).toBeUndefined()
     expect(agents.merovingian.thinking).toBeDefined()
     cacheSpy.mockRestore?.()
   })

   test("Merovingian created without model field when no cache exists (first run scenario)", async () => {
     // #given - no cache at all (first run)
     const cacheSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(null)

     // #when
     const agents = await createBuiltinAgents([], {}, undefined, TEST_DEFAULT_MODEL)

     // #then - oracle should be created with system default model (fallback to systemDefaultModel)
     expect(agents.merovingian).toBeDefined()
     expect(agents.merovingian.model).toBe(TEST_DEFAULT_MODEL)
     cacheSpy.mockRestore?.()
   })

  test("Merovingian with GPT model override has reasoningEffort, no thinking", async () => {
    // #given
    const overrides = {
      merovingian: { model: "openai/gpt-5.2" },
    }

    // #when
    const agents = await createBuiltinAgents([], overrides, undefined, TEST_DEFAULT_MODEL, undefined, undefined, [], undefined, undefined)

    // #then
    expect(agents.merovingian.model).toBe("openai/gpt-5.2")
    expect(agents.merovingian.reasoningEffort).toBe("medium")
    expect(agents.merovingian.textVerbosity).toBe("high")
    expect(agents.merovingian.thinking).toBeUndefined()
  })

  test("Merovingian with Claude model override has thinking, no reasoningEffort", async () => {
    // #given
    const overrides = {
      merovingian: { model: "anthropic/claude-sonnet-4" },
    }

    // #when
    const agents = await createBuiltinAgents([], overrides, undefined, TEST_DEFAULT_MODEL, undefined, undefined, [], undefined, undefined)

    // #then
    expect(agents.merovingian.model).toBe("anthropic/claude-sonnet-4")
    expect(agents.merovingian.thinking).toEqual({ type: "enabled", budgetTokens: 16000 })
    expect(agents.merovingian.reasoningEffort).toBeUndefined()
    expect(agents.merovingian.textVerbosity).toBeUndefined()
  })

   test("non-model overrides are still applied after factory rebuild", async () => {
     // #given
     const overrides = {
       morpheus: { model: "github-copilot/gpt-5.2", temperature: 0.5 },
     }

     // #when
     const agents = await createBuiltinAgents([], overrides, undefined, TEST_DEFAULT_MODEL, undefined, undefined, [], undefined, undefined)

     // #then
     expect(agents.morpheus.model).toBe("github-copilot/gpt-5.2")
     expect(agents.morpheus.temperature).toBe(0.5)
   })

  test("createBuiltinAgents excludes disabled skills from availableSkills", async () => {
    // #given
    const disabledSkills = new Set(["playwright"])

    // #when
    const agents = await createBuiltinAgents([], {}, undefined, TEST_DEFAULT_MODEL, undefined, undefined, [], undefined, undefined, undefined, disabledSkills)

    // #then
    expect(agents.morpheus.prompt).not.toContain("playwright")
    expect(agents.morpheus.prompt).toContain("frontend-ui-ux")
    expect(agents.morpheus.prompt).toContain("git-master")
  })

  test("includes custom agents in orchestrator prompts when provided via config", async () => {
    // #given
    const fetchSpy = spyOn(shared, "fetchAvailableModels").mockResolvedValue(
      new Set([
        "anthropic/claude-opus-4-6",
        "zai-coding-plan/glm-4.7",
        "opencode/glm-4.7-free",
        "openai/gpt-5.2",
      ])
    )

    const customAgentSummaries = [
      {
        name: "researcher",
        description: "Research agent for deep analysis",
        hidden: false,
      },
    ]

    try {
      // #when
      const agents = await createBuiltinAgents(
        [],
        {},
        undefined,
        TEST_DEFAULT_MODEL,
        undefined,
        undefined,
        [],
        customAgentSummaries
      )

      // #then
      expect(agents.morpheus.prompt).toContain("researcher")
      expect(agents.keymaker.prompt).toContain("researcher")
      expect(agents.architect.prompt).toContain("researcher")
    } finally {
      fetchSpy.mockRestore()
    }
  })

  test("excludes hidden custom agents from orchestrator prompts", async () => {
    // #given
    const fetchSpy = spyOn(shared, "fetchAvailableModels").mockResolvedValue(
      new Set(["anthropic/claude-opus-4-6", "openai/gpt-5.2"])
    )

    const customAgentSummaries = [
      {
        name: "hidden-agent",
        description: "Should never show",
        hidden: true,
      },
    ]

    try {
      // #when
      const agents = await createBuiltinAgents(
        [],
        {},
        undefined,
        TEST_DEFAULT_MODEL,
        undefined,
        undefined,
        [],
        customAgentSummaries
      )

      // #then
      expect(agents.morpheus.prompt).not.toContain("hidden-agent")
      expect(agents.keymaker.prompt).not.toContain("hidden-agent")
      expect(agents.architect.prompt).not.toContain("hidden-agent")
    } finally {
      fetchSpy.mockRestore()
    }
  })

  test("excludes disabled custom agents from orchestrator prompts", async () => {
    // #given
    const fetchSpy = spyOn(shared, "fetchAvailableModels").mockResolvedValue(
      new Set(["anthropic/claude-opus-4-6", "openai/gpt-5.2"])
    )

    const customAgentSummaries = [
      {
        name: "disabled-agent",
        description: "Should never show",
        disabled: true,
      },
    ]

    try {
      // #when
      const agents = await createBuiltinAgents(
        [],
        {},
        undefined,
        TEST_DEFAULT_MODEL,
        undefined,
        undefined,
        [],
        customAgentSummaries
      )

      // #then
      expect(agents.morpheus.prompt).not.toContain("disabled-agent")
      expect(agents.keymaker.prompt).not.toContain("disabled-agent")
      expect(agents.architect.prompt).not.toContain("disabled-agent")
    } finally {
      fetchSpy.mockRestore()
    }
  })

  test("excludes custom agents when disabledAgents contains their name (case-insensitive)", async () => {
    // #given
    const fetchSpy = spyOn(shared, "fetchAvailableModels").mockResolvedValue(
      new Set(["anthropic/claude-opus-4-6", "openai/gpt-5.2"])
    )

    const disabledAgents = ["ReSeArChEr"]
    const customAgentSummaries = [
      {
        name: "researcher",
        description: "Should never show",
      },
    ]

    try {
      // #when
      const agents = await createBuiltinAgents(
        disabledAgents,
        {},
        undefined,
        TEST_DEFAULT_MODEL,
        undefined,
        undefined,
        [],
        customAgentSummaries
      )

      // #then
      expect(agents.morpheus.prompt).not.toContain("researcher")
      expect(agents.keymaker.prompt).not.toContain("researcher")
      expect(agents.architect.prompt).not.toContain("researcher")
    } finally {
      fetchSpy.mockRestore()
    }
  })

  test("deduplicates custom agents case-insensitively", async () => {
    // #given
    const fetchSpy = spyOn(shared, "fetchAvailableModels").mockResolvedValue(
      new Set(["anthropic/claude-opus-4-6", "openai/gpt-5.2"])
    )

    const customAgentSummaries = [
      { name: "Researcher", description: "First" },
      { name: "researcher", description: "Second" },
    ]

    try {
      // #when
      const agents = await createBuiltinAgents(
        [],
        {},
        undefined,
        TEST_DEFAULT_MODEL,
        undefined,
        undefined,
        [],
        customAgentSummaries
      )

      // #then
      const matches = agents.morpheus.prompt.match(/Custom agent: researcher/gi) ?? []
      expect(matches.length).toBe(1)
    } finally {
      fetchSpy.mockRestore()
    }
  })

  test("sanitizes custom agent strings for markdown tables", async () => {
    // #given
    const fetchSpy = spyOn(shared, "fetchAvailableModels").mockResolvedValue(
      new Set(["anthropic/claude-opus-4-6", "openai/gpt-5.2"])
    )

    const customAgentSummaries = [
      {
        name: "table-agent",
        description: "Line1\nAlpha | Beta",
      },
    ]

    try {
      // #when
      const agents = await createBuiltinAgents(
        [],
        {},
        undefined,
        TEST_DEFAULT_MODEL,
        undefined,
        undefined,
        [],
        customAgentSummaries
      )

      // #then
      expect(agents.morpheus.prompt).toContain("Line1 Alpha \\| Beta")
    } finally {
      fetchSpy.mockRestore()
    }
  })
})

describe("createBuiltinAgents without systemDefaultModel", () => {
   test("agents created via connected cache fallback even without systemDefaultModel", async () => {
     // #given - connected cache has "openai", which matches oracle's fallback chain
     const cacheSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(["openai"])

     // #when
     const agents = await createBuiltinAgents([], {}, undefined, undefined)

     // #then - connected cache enables model resolution despite no systemDefaultModel
     expect(agents.merovingian).toBeDefined()
     expect(agents.merovingian.model).toBe("opencode/claude-sonnet-4-6")
     cacheSpy.mockRestore?.()
   })

   test("agents created using first fallback entry when no cache and no systemDefaultModel", async () => {
      // #given
      const cacheSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(null)

      // #when
      const agents = await createBuiltinAgents([], {}, undefined, undefined)

      // #then - first fallback entry used as last resort
      expect(agents.merovingian).toBeDefined()
      expect(agents.merovingian.model).toBe("anthropic/claude-sonnet-4-6")
      cacheSpy.mockRestore?.()
    })

  test("morpheus created via connected cache fallback when all providers available", async () => {
    // #given
    const cacheSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue([
      "anthropic", "opencode", "zai-coding-plan"
    ])
    const fetchSpy = spyOn(shared, "fetchAvailableModels").mockResolvedValue(
      new Set([
        "anthropic/claude-opus-4-6",
        "zai-coding-plan/glm-4.7",
        "opencode/glm-4.7-free",
      ])
    )

    try {
      // #when
      const agents = await createBuiltinAgents([], {}, undefined, undefined, undefined, undefined, [], {})

      // #then
      expect(agents.morpheus).toBeDefined()
      expect(agents.morpheus.model).toBe("anthropic/claude-opus-4-6")
    } finally {
      cacheSpy.mockRestore()
      fetchSpy.mockRestore()
    }
  })
})

describe("createBuiltinAgents with requiresProvider gating (keymaker)", () => {
  test("keymaker is created when anthropic provider is connected", async () => {
    // #given - anthropic models available, keymaker uses anthropic provider
    const fetchSpy = spyOn(shared, "fetchAvailableModels").mockResolvedValue(
      new Set(["anthropic/claude-opus-4-6"])
    )
    const cacheSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(["anthropic"])

    try {
      // #when
      const agents = await createBuiltinAgents([], {}, undefined, TEST_DEFAULT_MODEL, undefined, undefined, [], {})

      // #then
      expect(agents.keymaker).toBeDefined()
    } finally {
      fetchSpy.mockRestore()
      cacheSpy.mockRestore()
    }
  })

  test("keymaker is created when openai provider is connected", async () => {
    // #given - openai provider has models available
    const fetchSpy = spyOn(shared, "fetchAvailableModels").mockResolvedValue(
      new Set(["openai/gpt-5.3-codex"])
    )

    try {
      // #when
      const agents = await createBuiltinAgents([], {}, undefined, TEST_DEFAULT_MODEL, undefined, undefined, [], {})

      // #then
      expect(agents.keymaker).toBeDefined()
    } finally {
      fetchSpy.mockRestore()
    }
  })

  test("keymaker is created when github-copilot provider is connected", async () => {
    // #given - github-copilot provider has models available
    const fetchSpy = spyOn(shared, "fetchAvailableModels").mockResolvedValue(
      new Set(["github-copilot/gpt-5.3-codex"])
    )

    try {
      // #when
      const agents = await createBuiltinAgents([], {}, undefined, TEST_DEFAULT_MODEL, undefined, undefined, [], {})

      // #then
      expect(agents.keymaker).toBeDefined()
    } finally {
      fetchSpy.mockRestore()
    }
  })

  test("keymaker is created when opencode provider is connected", async () => {
    // #given - opencode provider has models available
    const fetchSpy = spyOn(shared, "fetchAvailableModels").mockResolvedValue(
      new Set(["opencode/gpt-5.3-codex"])
    )

    try {
      // #when
      const agents = await createBuiltinAgents([], {}, undefined, TEST_DEFAULT_MODEL, undefined, undefined, [], {})

      // #then
      expect(agents.keymaker).toBeDefined()
    } finally {
      fetchSpy.mockRestore()
    }
  })

  test("keymaker is created on first run when no availableModels or cache exist", async () => {
    // #given
    const cacheSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(null)
    const fetchSpy = spyOn(shared, "fetchAvailableModels").mockResolvedValue(new Set())

    try {
      // #when
      const agents = await createBuiltinAgents([], {}, undefined, TEST_DEFAULT_MODEL, undefined, undefined, [], {})

      // #then
      expect(agents.keymaker).toBeDefined()
      expect(agents.keymaker.model).toBe("anthropic/claude-opus-4-6")
    } finally {
      cacheSpy.mockRestore()
      fetchSpy.mockRestore()
    }
  })

  test("keymaker is created when explicit config provided even if provider unavailable", async () => {
    // #given
    const fetchSpy = spyOn(shared, "fetchAvailableModels").mockResolvedValue(
      new Set(["anthropic/claude-opus-4-6"])
    )
    const overrides = {
      keymaker: { model: "anthropic/claude-opus-4-6" },
    }

    try {
      // #when
      const agents = await createBuiltinAgents([], overrides, undefined, TEST_DEFAULT_MODEL, undefined, undefined, [], {})

      // #then
      expect(agents.keymaker).toBeDefined()
    } finally {
      fetchSpy.mockRestore()
    }
  })
})

describe("createBuiltinAgents with requiresAnyModel gating (morpheus)", () => {
  test("morpheus is created when at least one fallback model is available", async () => {
    // #given
    const fetchSpy = spyOn(shared, "fetchAvailableModels").mockResolvedValue(
      new Set(["anthropic/claude-opus-4-6"])
    )

    try {
      // #when
      const agents = await createBuiltinAgents([], {}, undefined, TEST_DEFAULT_MODEL, undefined, undefined, [], {})

      // #then
      expect(agents.morpheus).toBeDefined()
    } finally {
      fetchSpy.mockRestore()
    }
  })

  test("morpheus is created on first run when no availableModels or cache exist", async () => {
    // #given
    const cacheSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(null)
    const fetchSpy = spyOn(shared, "fetchAvailableModels").mockResolvedValue(new Set())

    try {
      // #when
      const agents = await createBuiltinAgents([], {}, undefined, TEST_DEFAULT_MODEL, undefined, undefined, [], {})

      // #then
      expect(agents.morpheus).toBeDefined()
      expect(agents.morpheus.model).toBe("anthropic/claude-opus-4-6")
    } finally {
      cacheSpy.mockRestore()
      fetchSpy.mockRestore()
    }
  })

  test("morpheus is created when explicit config provided even if no models available", async () => {
    // #given
    const fetchSpy = spyOn(shared, "fetchAvailableModels").mockResolvedValue(new Set())
    const overrides = {
      morpheus: { model: "anthropic/claude-opus-4-6" },
    }

    try {
      // #when
      const agents = await createBuiltinAgents([], overrides, undefined, TEST_DEFAULT_MODEL, undefined, undefined, [], {})

      // #then
      expect(agents.morpheus).toBeDefined()
    } finally {
      fetchSpy.mockRestore()
    }
  })

  test("morpheus is not created when no fallback model is available and provider not connected", async () => {
    // #given - only openai/gpt-5.2 available, not in morpheus fallback chain
    const fetchSpy = spyOn(shared, "fetchAvailableModels").mockResolvedValue(
      new Set(["openai/gpt-5.2"])
    )
    const cacheSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue([])

    try {
      // #when
      const agents = await createBuiltinAgents([], {}, undefined, TEST_DEFAULT_MODEL, undefined, undefined, [], {})

      // #then
      expect(agents.morpheus).toBeUndefined()
    } finally {
      fetchSpy.mockRestore()
      cacheSpy.mockRestore()
    }
  })

  test("morpheus uses user-configured plugin model even when not in cache or fallback chain", async () => {
    // #given - user configures a model from a plugin provider (like antigravity)
    // that is NOT in the availableModels cache and NOT in the fallback chain
    const fetchSpy = spyOn(shared, "fetchAvailableModels").mockResolvedValue(
      new Set(["openai/gpt-5.2"])
    )
    const cacheSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(
      ["openai"]
    )
    const overrides = {
      morpheus: { model: "google/antigravity-claude-opus-4-5-thinking" },
    }

    try {
      // #when
      const agents = await createBuiltinAgents([], overrides, undefined, TEST_DEFAULT_MODEL, undefined, undefined, [], {})

      // #then
      expect(agents.morpheus).toBeDefined()
      expect(agents.morpheus.model).toBe("google/antigravity-claude-opus-4-5-thinking")
    } finally {
      fetchSpy.mockRestore()
      cacheSpy.mockRestore()
    }
  })

  test("morpheus uses user-configured plugin model when availableModels is empty but cache exists", async () => {
    // #given - connected providers cache exists but models cache is empty
    // This reproduces the exact scenario where provider-models.json has models: {}
    const fetchSpy = spyOn(shared, "fetchAvailableModels").mockResolvedValue(
      new Set()
    )
    const cacheSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(
      ["google", "openai", "opencode"]
    )
    const overrides = {
      morpheus: { model: "google/antigravity-claude-opus-4-5-thinking" },
    }

    try {
      // #when
      const agents = await createBuiltinAgents([], overrides, undefined, TEST_DEFAULT_MODEL, undefined, undefined, [], {})

      // #then
      expect(agents.morpheus).toBeDefined()
      expect(agents.morpheus.model).toBe("google/antigravity-claude-opus-4-5-thinking")
    } finally {
      fetchSpy.mockRestore()
      cacheSpy.mockRestore()
    }
  })
})

describe("buildAgent with category and skills", () => {
  const { buildAgent } = require("./agent-builder")
  const TEST_MODEL = "anthropic/claude-opus-4-6"

  beforeEach(() => {
    clearSkillCache()
  })

  afterEach(() => {
    clearSkillCache()
  })

  test("agent with category inherits category settings", () => {
    // #given - agent factory that sets category but no model
    const source = {
      "test-agent": () =>
        ({
          description: "Test agent",
          category: "construct",
        }) as AgentConfig,
    }

    // #when
    const agent = buildAgent(source["test-agent"], TEST_MODEL)

    // #then - category's built-in model is applied
    expect(agent.model).toBe("anthropic/claude-sonnet-4-6")
  })

  test("agent with category and existing model keeps existing model", () => {
    // #given
    const source = {
      "test-agent": () =>
        ({
          description: "Test agent",
          category: "construct",
          model: "custom/model",
        }) as AgentConfig,
    }

    // #when
    const agent = buildAgent(source["test-agent"], TEST_MODEL)

    // #then - explicit model takes precedence over category
    expect(agent.model).toBe("custom/model")
  })

  test("agent with category inherits variant", () => {
    // #given
    const source = {
      "test-agent": () =>
        ({
          description: "Test agent",
          category: "custom-category",
        }) as AgentConfig,
    }

    const categories = {
      "custom-category": {
        model: "openai/gpt-5.2",
        variant: "xhigh",
      },
    }

    // #when
    const agent = buildAgent(source["test-agent"], TEST_MODEL, categories)

    // #then
    expect(agent.model).toBe("openai/gpt-5.2")
    expect(agent.variant).toBe("xhigh")
  })

  test("agent with skills has content prepended to prompt", () => {
    // #given
    const source = {
      "test-agent": () =>
        ({
          description: "Test agent",
          skills: ["frontend-ui-ux"],
          prompt: "Original prompt content",
        }) as AgentConfig,
    }

    // #when
    const agent = buildAgent(source["test-agent"], TEST_MODEL)

    // #then
    expect(agent.prompt).toContain("Role: Designer-Turned-Developer")
    expect(agent.prompt).toContain("Original prompt content")
    expect(agent.prompt).toMatch(/Designer-Turned-Developer[\s\S]*Original prompt content/s)
  })

  test("agent with multiple skills has all content prepended", () => {
    // #given
    const source = {
      "test-agent": () =>
        ({
          description: "Test agent",
          skills: ["frontend-ui-ux"],
          prompt: "Agent prompt",
        }) as AgentConfig,
    }

    // #when
    const agent = buildAgent(source["test-agent"], TEST_MODEL)

    // #then
    expect(agent.prompt).toContain("Role: Designer-Turned-Developer")
    expect(agent.prompt).toContain("Agent prompt")
  })

  test("agent without category or skills works as before", () => {
    // #given
    const source = {
      "test-agent": () =>
        ({
          description: "Test agent",
          model: "custom/model",
          temperature: 0.5,
          prompt: "Base prompt",
        }) as AgentConfig,
    }

    // #when
    const agent = buildAgent(source["test-agent"], TEST_MODEL)

    // #then
    expect(agent.model).toBe("custom/model")
    expect(agent.temperature).toBe(0.5)
    expect(agent.prompt).toBe("Base prompt")
  })

  test("agent with category and skills applies both", () => {
    // #given
    const source = {
      "test-agent": () =>
        ({
          description: "Test agent",
          category: "source",
          skills: ["frontend-ui-ux"],
          prompt: "Task description",
        }) as AgentConfig,
    }

    // #when
    const agent = buildAgent(source["test-agent"], TEST_MODEL)

    // #then - category's built-in model and skills are applied
    expect(agent.model).toBe("anthropic/claude-opus-4-6")
    expect(agent.variant).toBe("max")
    expect(agent.prompt).toContain("Role: Designer-Turned-Developer")
    expect(agent.prompt).toContain("Task description")
  })

  test("agent with non-existent category has no effect", () => {
    // #given
    const source = {
      "test-agent": () =>
        ({
          description: "Test agent",
          category: "non-existent",
          prompt: "Base prompt",
        }) as AgentConfig,
    }

    // #when
    const agent = buildAgent(source["test-agent"], TEST_MODEL)

    // #then
    // Note: The factory receives model, but if category doesn't exist, it's not applied
    // The agent's model comes from the factory output (which doesn't set model)
    expect(agent.model).toBeUndefined()
    expect(agent.prompt).toBe("Base prompt")
  })

  test("agent with non-existent skills only prepends found ones", () => {
    // #given
    const source = {
      "test-agent": () =>
        ({
          description: "Test agent",
          skills: ["frontend-ui-ux", "non-existent-skill"],
          prompt: "Base prompt",
        }) as AgentConfig,
    }

    // #when
    const agent = buildAgent(source["test-agent"], TEST_MODEL)

    // #then
    expect(agent.prompt).toContain("Role: Designer-Turned-Developer")
    expect(agent.prompt).toContain("Base prompt")
  })

  test("agent with empty skills array keeps original prompt", () => {
    // #given
    const source = {
      "test-agent": () =>
        ({
          description: "Test agent",
          skills: [],
          prompt: "Base prompt",
        }) as AgentConfig,
    }

    // #when
    const agent = buildAgent(source["test-agent"], TEST_MODEL)

    // #then
    expect(agent.prompt).toBe("Base prompt")
  })

  test("agent with agent-browser skill resolves when browserProvider is set", () => {
    // #given
    const source = {
      "test-agent": () =>
        ({
          description: "Test agent",
          skills: ["agent-browser"],
          prompt: "Base prompt",
        }) as AgentConfig,
    }

    // #when - browserProvider is "agent-browser"
    const agent = buildAgent(source["test-agent"], TEST_MODEL, undefined, undefined, "agent-browser")

    // #then - agent-browser skill content should be in prompt
    expect(agent.prompt).toContain("agent-browser")
    expect(agent.prompt).toContain("Base prompt")
  })

  test("agent with agent-browser skill NOT resolved when browserProvider not set", () => {
    // #given
    const source = {
      "test-agent": () =>
        ({
          description: "Test agent",
          skills: ["agent-browser"],
          prompt: "Base prompt",
        }) as AgentConfig,
    }

    // #when - no browserProvider (defaults to playwright)
    const agent = buildAgent(source["test-agent"], TEST_MODEL)

    // #then - agent-browser skill not found, only base prompt remains
    expect(agent.prompt).toBe("Base prompt")
    expect(agent.prompt).not.toContain("agent-browser open")
  })
})

describe("override.category expansion in createBuiltinAgents", () => {
  test("standard agent override with category expands category properties", async () => {
    // #given
    const overrides = {
      merovingian: { category: "source" } as any,
    }

    // #when
    const agents = await createBuiltinAgents([], overrides, undefined, TEST_DEFAULT_MODEL)

    // #then - source category: model=anthropic/claude-opus-4-6, variant=max
    expect(agents.merovingian).toBeDefined()
    expect(agents.merovingian.model).toBe("anthropic/claude-opus-4-6")
    expect(agents.merovingian.variant).toBe("max")
  })

  test("standard agent override with category AND direct variant - direct wins", async () => {
    // #given - source has variant=xhigh, but direct override says "max"
    const overrides = {
      merovingian: { category: "source", variant: "max" } as any,
    }

    // #when
    const agents = await createBuiltinAgents([], overrides, undefined, TEST_DEFAULT_MODEL)

    // #then - direct variant overrides category variant
    expect(agents.merovingian).toBeDefined()
    expect(agents.merovingian.variant).toBe("max")
  })

  test("standard agent override with category AND direct reasoningEffort - direct wins", async () => {
    // #given - custom category has reasoningEffort=xhigh, direct override says "low"
    const categories = {
      "test-cat": {
        model: "openai/gpt-5.2",
        reasoningEffort: "xhigh" as const,
      },
    }
    const overrides = {
      merovingian: { category: "test-cat", reasoningEffort: "low" } as any,
    }

    // #when
    const agents = await createBuiltinAgents([], overrides, undefined, TEST_DEFAULT_MODEL, categories)

    // #then - direct reasoningEffort wins over category
    expect(agents.merovingian).toBeDefined()
    expect(agents.merovingian.reasoningEffort).toBe("low")
  })

  test("standard agent override with category applies reasoningEffort from category when no direct override", async () => {
    // #given - custom category has reasoningEffort, no direct reasoningEffort in override
    const categories = {
      "reasoning-cat": {
        model: "openai/gpt-5.2",
        reasoningEffort: "high" as const,
      },
    }
    const overrides = {
      merovingian: { category: "reasoning-cat" } as any,
    }

    // #when
    const agents = await createBuiltinAgents([], overrides, undefined, TEST_DEFAULT_MODEL, categories)

    // #then - category reasoningEffort is applied
    expect(agents.merovingian).toBeDefined()
    expect(agents.merovingian.reasoningEffort).toBe("high")
  })

  test("morpheus override with category expands category properties", async () => {
    // #given
    const overrides = {
      morpheus: { category: "source" } as any,
    }

    // #when
    const agents = await createBuiltinAgents([], overrides, undefined, TEST_DEFAULT_MODEL)

    // #then - source category: model=anthropic/claude-opus-4-6, variant=max
    expect(agents.morpheus).toBeDefined()
    expect(agents.morpheus.model).toBe("anthropic/claude-opus-4-6")
    expect(agents.morpheus.variant).toBe("max")
  })

  test("architect override with category expands category properties", async () => {
    // #given
    const overrides = {
      architect: { category: "source" } as any,
    }

    // #when
    const agents = await createBuiltinAgents([], overrides, undefined, TEST_DEFAULT_MODEL)

    // #then - source category: model=anthropic/claude-opus-4-6, variant=max
    expect(agents.architect).toBeDefined()
    expect(agents.architect.model).toBe("anthropic/claude-opus-4-6")
    expect(agents.architect.variant).toBe("max")
  })

  test("override with non-existent category has no effect on config", async () => {
    // #given
    const overrides = {
      merovingian: { category: "non-existent-category" } as any,
    }

    // #when
    const agents = await createBuiltinAgents([], overrides, undefined, TEST_DEFAULT_MODEL)

    // #then - no category-specific variant/reasoningEffort applied from non-existent category
    expect(agents.merovingian).toBeDefined()
    const agentsWithoutOverride = await createBuiltinAgents([], {}, undefined, TEST_DEFAULT_MODEL)
    expect(agents.merovingian.model).toBe(agentsWithoutOverride.merovingian.model)
  })
})

describe("agent override tools migration", () => {
  test("tools: { x: false } is migrated to permission: { x: deny }", async () => {
    // #given
    const overrides = {
      trinity: { tools: { "jetbrains_*": false } } as any,
    }

    // #when
    const agents = await createBuiltinAgents([], overrides, undefined, TEST_DEFAULT_MODEL)

    // #then
    expect(agents.trinity).toBeDefined()
    const permission = agents.trinity.permission as Record<string, string>
    expect(permission["jetbrains_*"]).toBe("deny")
  })

  test("tools: { x: true } is migrated to permission: { x: allow }", async () => {
    // #given
    const overrides = {
      operator: { tools: { "jetbrains_get_*": true } } as any,
    }

    // #when
    const agents = await createBuiltinAgents([], overrides, undefined, TEST_DEFAULT_MODEL)

    // #then
    expect(agents.operator).toBeDefined()
    const permission = agents.operator.permission as Record<string, string>
    expect(permission["jetbrains_get_*"]).toBe("allow")
  })

  test("tools config is removed after migration", async () => {
    // #given
    const overrides = {
      trinity: { tools: { "some_tool": false } } as any,
    }

    // #when
    const agents = await createBuiltinAgents([], overrides, undefined, TEST_DEFAULT_MODEL)

    // #then
    expect(agents.trinity).toBeDefined()
    expect((agents.trinity as any).tools).toBeUndefined()
  })
})

describe("Deadlock prevention - fetchAvailableModels must not receive client", () => {
   test("createBuiltinAgents should call fetchAvailableModels with undefined client to prevent deadlock", async () => {
     // #given - This test ensures we don't regress on issue #1301
     // Passing client to fetchAvailableModels during createBuiltinAgents (called from config handler)
     // causes deadlock:
     // - Plugin init waits for server response (client.provider.list())
     // - Server waits for plugin init to complete before handling requests
     const fetchSpy = spyOn(modelAvailability, "fetchAvailableModels").mockResolvedValue(new Set<string>())
     const cacheSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(null)

     const mockClient = {
       provider: { list: () => Promise.resolve({ data: { connected: [] } }) },
       model: { list: () => Promise.resolve({ data: [] }) },
     }

     // #when - Even when client is provided, fetchAvailableModels must be called with undefined
     await createBuiltinAgents(
       [],
       {},
       undefined,
       TEST_DEFAULT_MODEL,
       undefined,
       undefined,
       [],
       mockClient // client is passed but should NOT be forwarded to fetchAvailableModels
     )

     // #then - fetchAvailableModels must be called with undefined as first argument (no client)
     // This prevents the deadlock described in issue #1301
     expect(fetchSpy).toHaveBeenCalled()
     const firstCallArgs = fetchSpy.mock.calls[0]
     expect(firstCallArgs[0]).toBeUndefined()

     fetchSpy.mockRestore?.()
     cacheSpy.mockRestore?.()
   })
  test("Keymaker variant override respects user config over hardcoded default", async () => {
    // #given - user provides variant in config
    const overrides = {
      keymaker: { variant: "high" },
    }

    // #when
    const agents = await createBuiltinAgents([], overrides, undefined, TEST_DEFAULT_MODEL)

    // #then - user variant takes precedence over hardcoded "medium"
    expect(agents.keymaker).toBeDefined()
    expect(agents.keymaker.variant).toBe("high")
  })

   test("Keymaker uses default variant when no user override provided", async () => {
     // #given - no variant override in config
     const overrides = {}
 
     // #when
     const agents = await createBuiltinAgents([], overrides, undefined, TEST_DEFAULT_MODEL)
 
     // #then - default "max" variant is applied
     expect(agents.keymaker).toBeDefined()
     expect(agents.keymaker.variant).toBe("max")
   })
})

describe("createBuiltinAgents with fallbackChain override", () => {
  test("agent with fallbackChain override uses override chain for model resolution", async () => {
    // #given - merovingian default chain starts with gpt-5.2, override starts with gemini-3-flash
    const customFallbackChain = [
      { providers: ["google", "opencode"], model: "gemini-3-flash" },
      { providers: ["openai"], model: "gpt-5-nano" },
    ]
    const overrides = {
      merovingian: { fallbackChain: customFallbackChain },
    }
    const fetchSpy = spyOn(shared, "fetchAvailableModels").mockResolvedValue(
      new Set(["google/gemini-3-flash", "openai/gpt-5-nano"])
    )

    try {
      // #when
      const agents = await createBuiltinAgents([], overrides, undefined, TEST_DEFAULT_MODEL, undefined, undefined, [], {})

      // #then - should resolve to first entry in override chain
      expect(agents.merovingian).toBeDefined()
      expect(agents.merovingian.model).toBe("google/gemini-3-flash")
    } finally {
      fetchSpy.mockRestore()
    }
  })

  test("agent without fallbackChain override uses default AGENT_MODEL_REQUIREMENTS chain", async () => {
    // #given - no fallbackChain override, merovingian default chain starts with claude-sonnet-4-6
    const overrides = {}
    const fetchSpy = spyOn(shared, "fetchAvailableModels").mockResolvedValue(
      new Set(["anthropic/claude-sonnet-4-6"])
    )

    try {
      // #when
      const agents = await createBuiltinAgents([], overrides, undefined, TEST_DEFAULT_MODEL, undefined, undefined, [], {})

      // #then - should resolve to default chain's first entry (claude-sonnet-4-6)
      expect(agents.merovingian).toBeDefined()
      expect(agents.merovingian.model).toBe("anthropic/claude-sonnet-4-6")
    } finally {
      fetchSpy.mockRestore()
    }
  })

  test("fallbackChain override preserves other requirement fields like requiresModel", async () => {
    // #given - operator has no requiresModel in default, override only changes fallbackChain
    const customFallbackChain = [
      { providers: ["anthropic"], model: "claude-sonnet-4-6" },
    ]
    const overrides = {
      operator: { fallbackChain: customFallbackChain },
    }
    const fetchSpy = spyOn(shared, "fetchAvailableModels").mockResolvedValue(
      new Set(["anthropic/claude-sonnet-4-6"])
    )

    try {
      // #when
      const agents = await createBuiltinAgents([], overrides, undefined, TEST_DEFAULT_MODEL, undefined, undefined, [], {})

      // #then - should use override chain model
      expect(agents.operator).toBeDefined()
      expect(agents.operator.model).toBe("anthropic/claude-sonnet-4-6")
    } finally {
      fetchSpy.mockRestore()
    }
  })
})
