/// <reference types="bun-types" />

import { describe, test, expect, spyOn, beforeEach, afterEach } from "bun:test"
import { resolveCategoryConfig, createConfigHandler } from "./config-handler"
import type { CategoryConfig } from "../config/schema"
import type { OhMyOpenCodeConfig } from "../config"

import * as agents from "../agents"
import * as sisyphusJunior from "../agents/sisyphus-junior"
import * as commandLoader from "../features/claude-code-command-loader"
import * as builtinCommands from "../features/builtin-commands"
import * as skillLoader from "../features/opencode-skill-loader"
import * as agentLoader from "../features/claude-code-agent-loader"
import * as mcpLoader from "../features/claude-code-mcp-loader"
import * as pluginLoader from "../features/claude-code-plugin-loader"
import * as mcpModule from "../mcp"
import * as shared from "../shared"
import * as configDir from "../shared/opencode-config-dir"
import * as permissionCompat from "../shared/permission-compat"
import * as modelResolver from "../shared/model-resolver"

beforeEach(() => {
  spyOn(agents, "createBuiltinAgents" as any).mockResolvedValue({
    sisyphus: { name: "sisyphus", prompt: "test", mode: "primary" },
    oracle: { name: "oracle", prompt: "test", mode: "subagent" },
  })

  spyOn(commandLoader, "loadUserCommands" as any).mockResolvedValue({})
  spyOn(commandLoader, "loadProjectCommands" as any).mockResolvedValue({})
  spyOn(commandLoader, "loadOpencodeGlobalCommands" as any).mockResolvedValue({})
  spyOn(commandLoader, "loadOpencodeProjectCommands" as any).mockResolvedValue({})

  spyOn(builtinCommands, "loadBuiltinCommands" as any).mockReturnValue({})

  spyOn(skillLoader, "loadUserSkills" as any).mockResolvedValue({})
  spyOn(skillLoader, "loadProjectSkills" as any).mockResolvedValue({})
  spyOn(skillLoader, "loadOpencodeGlobalSkills" as any).mockResolvedValue({})
  spyOn(skillLoader, "loadOpencodeProjectSkills" as any).mockResolvedValue({})
  spyOn(skillLoader, "discoverUserClaudeSkills" as any).mockResolvedValue([])
  spyOn(skillLoader, "discoverProjectClaudeSkills" as any).mockResolvedValue([])
  spyOn(skillLoader, "discoverOpencodeGlobalSkills" as any).mockResolvedValue([])
  spyOn(skillLoader, "discoverOpencodeProjectSkills" as any).mockResolvedValue([])

  spyOn(agentLoader, "loadUserAgents" as any).mockReturnValue({})
  spyOn(agentLoader, "loadProjectAgents" as any).mockReturnValue({})

  spyOn(mcpLoader, "loadMcpConfigs" as any).mockResolvedValue({ servers: {} })

  spyOn(pluginLoader, "loadAllPluginComponents" as any).mockResolvedValue({
    commands: {},
    skills: {},
    agents: {},
    mcpServers: {},
    hooksConfigs: [],
    plugins: [],
    errors: [],
  })

  spyOn(mcpModule, "createBuiltinMcps" as any).mockReturnValue({})

  spyOn(shared, "log" as any).mockImplementation(() => {})
  spyOn(shared, "fetchAvailableModels" as any).mockResolvedValue(new Set(["anthropic/claude-opus-4-6"]))
  spyOn(shared, "readConnectedProvidersCache" as any).mockReturnValue(null)

  spyOn(configDir, "getOpenCodeConfigPaths" as any).mockReturnValue({
    global: "/tmp/.config/opencode",
    project: "/tmp/.opencode",
  })

  spyOn(permissionCompat, "migrateAgentConfig" as any).mockImplementation((config: Record<string, unknown>) => config)

  spyOn(modelResolver, "resolveModelWithFallback" as any).mockReturnValue({ model: "anthropic/claude-opus-4-6" })
})

afterEach(() => {
  (agents.createBuiltinAgents as any)?.mockRestore?.()
  ;(sisyphusJunior.createSisyphusJuniorAgentWithOverrides as any)?.mockRestore?.()
  ;(commandLoader.loadUserCommands as any)?.mockRestore?.()
  ;(commandLoader.loadProjectCommands as any)?.mockRestore?.()
  ;(commandLoader.loadOpencodeGlobalCommands as any)?.mockRestore?.()
  ;(commandLoader.loadOpencodeProjectCommands as any)?.mockRestore?.()
  ;(builtinCommands.loadBuiltinCommands as any)?.mockRestore?.()
  ;(skillLoader.loadUserSkills as any)?.mockRestore?.()
  ;(skillLoader.loadProjectSkills as any)?.mockRestore?.()
  ;(skillLoader.loadOpencodeGlobalSkills as any)?.mockRestore?.()
  ;(skillLoader.loadOpencodeProjectSkills as any)?.mockRestore?.()
  ;(skillLoader.discoverUserClaudeSkills as any)?.mockRestore?.()
  ;(skillLoader.discoverProjectClaudeSkills as any)?.mockRestore?.()
  ;(skillLoader.discoverOpencodeGlobalSkills as any)?.mockRestore?.()
  ;(skillLoader.discoverOpencodeProjectSkills as any)?.mockRestore?.()
  ;(agentLoader.loadUserAgents as any)?.mockRestore?.()
  ;(agentLoader.loadProjectAgents as any)?.mockRestore?.()
  ;(mcpLoader.loadMcpConfigs as any)?.mockRestore?.()
  ;(pluginLoader.loadAllPluginComponents as any)?.mockRestore?.()
  ;(mcpModule.createBuiltinMcps as any)?.mockRestore?.()
  ;(shared.log as any)?.mockRestore?.()
  ;(shared.fetchAvailableModels as any)?.mockRestore?.()
  ;(shared.readConnectedProvidersCache as any)?.mockRestore?.()
  ;(configDir.getOpenCodeConfigPaths as any)?.mockRestore?.()
  ;(permissionCompat.migrateAgentConfig as any)?.mockRestore?.()
  ;(modelResolver.resolveModelWithFallback as any)?.mockRestore?.()
})

describe("Sisyphus-Junior model inheritance", () => {
  test("does not inherit UI-selected model as system default", async () => {
    // #given
    const pluginConfig: OhMyOpenCodeConfig = {}
    const config: Record<string, unknown> = {
      model: "opencode/kimi-k2.5-free",
      agent: {},
    }
    const handler = createConfigHandler({
      ctx: { directory: "/tmp" },
      pluginConfig,
      modelCacheState: {
        anthropicContext1MEnabled: false,
        modelContextLimitsCache: new Map(),
      },
    })

    // #when
    await handler(config)

    // #then
    const agentConfig = config.agent as Record<string, { model?: string }>
    expect(agentConfig["sisyphus-junior"]?.model).toBe(
      sisyphusJunior.SISYPHUS_JUNIOR_DEFAULTS.model
    )
  })

  test("uses explicitly configured sisyphus-junior model", async () => {
    // #given
    const pluginConfig: OhMyOpenCodeConfig = {
      agents: {
        "sisyphus-junior": {
          model: "openai/gpt-5.3-codex",
        },
      },
    }
    const config: Record<string, unknown> = {
      model: "opencode/kimi-k2.5-free",
      agent: {},
    }
    const handler = createConfigHandler({
      ctx: { directory: "/tmp" },
      pluginConfig,
      modelCacheState: {
        anthropicContext1MEnabled: false,
        modelContextLimitsCache: new Map(),
      },
    })

    // #when
    await handler(config)

    // #then
    const agentConfig = config.agent as Record<string, { model?: string }>
    expect(agentConfig["sisyphus-junior"]?.model).toBe(
      "openai/gpt-5.3-codex"
    )
  })
})

describe("Plan agent demote behavior", () => {
  test("orders core agents as sisyphus -> hephaestus -> prometheus -> atlas", async () => {
    // #given
    const createBuiltinAgentsMock = agents.createBuiltinAgents as unknown as {
      mockResolvedValue: (value: Record<string, unknown>) => void
    }
    createBuiltinAgentsMock.mockResolvedValue({
      sisyphus: { name: "sisyphus", prompt: "test", mode: "primary" },
      hephaestus: { name: "hephaestus", prompt: "test", mode: "primary" },
      oracle: { name: "oracle", prompt: "test", mode: "subagent" },
      atlas: { name: "atlas", prompt: "test", mode: "primary" },
    })
    const pluginConfig: OhMyOpenCodeConfig = {
      sisyphus_agent: {
        planner_enabled: true,
      },
    }
    const config: Record<string, unknown> = {
      model: "anthropic/claude-opus-4-6",
      agent: {},
    }
    const handler = createConfigHandler({
      ctx: { directory: "/tmp" },
      pluginConfig,
      modelCacheState: {
        anthropicContext1MEnabled: false,
        modelContextLimitsCache: new Map(),
      },
    })

    // #when
    await handler(config)

    // #then
    const keys = Object.keys(config.agent as Record<string, unknown>)
    const coreAgents = ["sisyphus", "hephaestus", "prometheus", "atlas"]
    const ordered = keys.filter((key) => coreAgents.includes(key))
    expect(ordered).toEqual(coreAgents)
  })

  test("plan agent should be demoted to subagent without inheriting prometheus prompt", async () => {
    // #given
    const pluginConfig: OhMyOpenCodeConfig = {
      sisyphus_agent: {
        planner_enabled: true,
        replace_plan: true,
      },
    }
    const config: Record<string, unknown> = {
      model: "anthropic/claude-opus-4-6",
      agent: {
        plan: {
          name: "plan",
          mode: "primary",
          prompt: "original plan prompt",
        },
      },
    }
    const handler = createConfigHandler({
      ctx: { directory: "/tmp" },
      pluginConfig,
      modelCacheState: {
        anthropicContext1MEnabled: false,
        modelContextLimitsCache: new Map(),
      },
    })

    // #when
    await handler(config)

    // #then - plan is demoted to subagent but does NOT inherit prometheus prompt
    const agents = config.agent as Record<string, { mode?: string; name?: string; prompt?: string }>
    expect(agents.plan).toBeDefined()
    expect(agents.plan.mode).toBe("subagent")
    expect(agents.plan.prompt).toBeUndefined()
    expect(agents.prometheus?.prompt).toBeDefined()
  })

  test("plan agent remains unchanged when planner is disabled", async () => {
    // #given
    const pluginConfig: OhMyOpenCodeConfig = {
      sisyphus_agent: {
        planner_enabled: false,
      },
    }
    const config: Record<string, unknown> = {
      model: "anthropic/claude-opus-4-6",
      agent: {
        plan: {
          name: "plan",
          mode: "primary",
          prompt: "original plan prompt",
        },
      },
    }
    const handler = createConfigHandler({
      ctx: { directory: "/tmp" },
      pluginConfig,
      modelCacheState: {
        anthropicContext1MEnabled: false,
        modelContextLimitsCache: new Map(),
      },
    })

    // #when
    await handler(config)

    // #then - plan is not touched, prometheus is not created
    const agents = config.agent as Record<string, { mode?: string; name?: string; prompt?: string }>
    expect(agents.prometheus).toBeUndefined()
    expect(agents.plan).toBeDefined()
    expect(agents.plan.mode).toBe("primary")
    expect(agents.plan.prompt).toBe("original plan prompt")
  })

  test("prometheus should have mode 'all' to be callable via task", async () => {
    // given
    const pluginConfig: OhMyOpenCodeConfig = {
      sisyphus_agent: {
        planner_enabled: true,
      },
    }
    const config: Record<string, unknown> = {
      model: "anthropic/claude-opus-4-6",
      agent: {},
    }
    const handler = createConfigHandler({
      ctx: { directory: "/tmp" },
      pluginConfig,
      modelCacheState: {
        anthropicContext1MEnabled: false,
        modelContextLimitsCache: new Map(),
      },
    })

    // when
    await handler(config)

    // then
    const agents = config.agent as Record<string, { mode?: string }>
    expect(agents.prometheus).toBeDefined()
    expect(agents.prometheus.mode).toBe("all")
  })
})

describe("Agent permission defaults", () => {
  test("hephaestus should allow task", async () => {
    // #given
    const createBuiltinAgentsMock = agents.createBuiltinAgents as unknown as {
      mockResolvedValue: (value: Record<string, unknown>) => void
    }
    createBuiltinAgentsMock.mockResolvedValue({
      sisyphus: { name: "sisyphus", prompt: "test", mode: "primary" },
      hephaestus: { name: "hephaestus", prompt: "test", mode: "primary" },
      oracle: { name: "oracle", prompt: "test", mode: "subagent" },
    })
    const pluginConfig: OhMyOpenCodeConfig = {}
    const config: Record<string, unknown> = {
      model: "anthropic/claude-opus-4-6",
      agent: {},
    }
    const handler = createConfigHandler({
      ctx: { directory: "/tmp" },
      pluginConfig,
      modelCacheState: {
        anthropicContext1MEnabled: false,
        modelContextLimitsCache: new Map(),
      },
    })

    // #when
    await handler(config)

    // #then
    const agentConfig = config.agent as Record<string, { permission?: Record<string, string> }>
    expect(agentConfig.hephaestus).toBeDefined()
    expect(agentConfig.hephaestus.permission?.task).toBe("allow")
  })
})

describe("Prometheus category config resolution", () => {
  test("resolves ultrabrain category config", () => {
    // given
    const categoryName = "ultrabrain"

    // when
    const config = resolveCategoryConfig(categoryName)

    // then
    expect(config).toBeDefined()
    expect(config?.model).toBe("openai/gpt-5.3-codex")
    expect(config?.variant).toBe("xhigh")
  })

  test("resolves visual-engineering category config", () => {
    // given
    const categoryName = "visual-engineering"

    // when
    const config = resolveCategoryConfig(categoryName)

    // then
    expect(config).toBeDefined()
    expect(config?.model).toBe("google/gemini-3-pro")
  })

  test("user categories override default categories", () => {
    // given
    const categoryName = "ultrabrain"
    const userCategories: Record<string, CategoryConfig> = {
      ultrabrain: {
        model: "google/antigravity-claude-opus-4-5-thinking",
        temperature: 0.1,
      },
    }

    // when
    const config = resolveCategoryConfig(categoryName, userCategories)

    // then
    expect(config).toBeDefined()
    expect(config?.model).toBe("google/antigravity-claude-opus-4-5-thinking")
    expect(config?.temperature).toBe(0.1)
  })

  test("returns undefined for unknown category", () => {
    // given
    const categoryName = "nonexistent-category"

    // when
    const config = resolveCategoryConfig(categoryName)

    // then
    expect(config).toBeUndefined()
  })

  test("falls back to default when user category has no entry", () => {
    // given
    const categoryName = "ultrabrain"
    const userCategories: Record<string, CategoryConfig> = {
      "visual-engineering": {
        model: "custom/visual-model",
      },
    }

    // when
    const config = resolveCategoryConfig(categoryName, userCategories)

    // then - falls back to DEFAULT_CATEGORIES
    expect(config).toBeDefined()
    expect(config?.model).toBe("openai/gpt-5.3-codex")
    expect(config?.variant).toBe("xhigh")
  })

  test("preserves all category properties (temperature, top_p, tools, etc.)", () => {
    // given
    const categoryName = "custom-category"
    const userCategories: Record<string, CategoryConfig> = {
      "custom-category": {
        model: "test/model",
        temperature: 0.5,
        top_p: 0.9,
        maxTokens: 32000,
        tools: { tool1: true, tool2: false },
      },
    }

    // when
    const config = resolveCategoryConfig(categoryName, userCategories)

    // then
    expect(config).toBeDefined()
    expect(config?.model).toBe("test/model")
    expect(config?.temperature).toBe(0.5)
    expect(config?.top_p).toBe(0.9)
    expect(config?.maxTokens).toBe(32000)
    expect(config?.tools).toEqual({ tool1: true, tool2: false })
  })
})

describe("Prometheus direct override priority over category", () => {
  test("direct reasoningEffort takes priority over category reasoningEffort", async () => {
    // given - category has reasoningEffort=xhigh, direct override says "low"
    const pluginConfig: OhMyOpenCodeConfig = {
      sisyphus_agent: {
        planner_enabled: true,
      },
      categories: {
        "test-planning": {
          model: "openai/gpt-5.2",
          reasoningEffort: "xhigh",
        },
      },
      agents: {
        prometheus: {
          category: "test-planning",
          reasoningEffort: "low",
        },
      },
    }
    const config: Record<string, unknown> = {
      model: "anthropic/claude-opus-4-6",
      agent: {},
    }
    const handler = createConfigHandler({
      ctx: { directory: "/tmp" },
      pluginConfig,
      modelCacheState: {
        anthropicContext1MEnabled: false,
        modelContextLimitsCache: new Map(),
      },
    })

    // when
    await handler(config)

    // then - direct override's reasoningEffort wins
    const agents = config.agent as Record<string, { reasoningEffort?: string }>
    expect(agents.prometheus).toBeDefined()
    expect(agents.prometheus.reasoningEffort).toBe("low")
  })

  test("category reasoningEffort applied when no direct override", async () => {
    // given - category has reasoningEffort but no direct override
    const pluginConfig: OhMyOpenCodeConfig = {
      sisyphus_agent: {
        planner_enabled: true,
      },
      categories: {
        "reasoning-cat": {
          model: "openai/gpt-5.2",
          reasoningEffort: "high",
        },
      },
      agents: {
        prometheus: {
          category: "reasoning-cat",
        },
      },
    }
    const config: Record<string, unknown> = {
      model: "anthropic/claude-opus-4-6",
      agent: {},
    }
    const handler = createConfigHandler({
      ctx: { directory: "/tmp" },
      pluginConfig,
      modelCacheState: {
        anthropicContext1MEnabled: false,
        modelContextLimitsCache: new Map(),
      },
    })

    // when
    await handler(config)

    // then - category's reasoningEffort is applied
    const agents = config.agent as Record<string, { reasoningEffort?: string }>
    expect(agents.prometheus).toBeDefined()
    expect(agents.prometheus.reasoningEffort).toBe("high")
  })

  test("direct temperature takes priority over category temperature", async () => {
    // given
    const pluginConfig: OhMyOpenCodeConfig = {
      sisyphus_agent: {
        planner_enabled: true,
      },
      categories: {
        "temp-cat": {
          model: "openai/gpt-5.2",
          temperature: 0.8,
        },
      },
      agents: {
        prometheus: {
          category: "temp-cat",
          temperature: 0.1,
        },
      },
    }
    const config: Record<string, unknown> = {
      model: "anthropic/claude-opus-4-6",
      agent: {},
    }
    const handler = createConfigHandler({
      ctx: { directory: "/tmp" },
      pluginConfig,
      modelCacheState: {
        anthropicContext1MEnabled: false,
        modelContextLimitsCache: new Map(),
      },
    })

    // when
    await handler(config)

    // then - direct temperature wins over category
    const agents = config.agent as Record<string, { temperature?: number }>
    expect(agents.prometheus).toBeDefined()
    expect(agents.prometheus.temperature).toBe(0.1)
  })

  test("prometheus prompt_append is appended to base prompt", async () => {
    // #given - prometheus override with prompt_append
    const customInstructions = "## Custom Project Rules\nUse max 2 commits."
    const pluginConfig: OhMyOpenCodeConfig = {
      sisyphus_agent: {
        planner_enabled: true,
      },
      agents: {
        prometheus: {
          prompt_append: customInstructions,
        },
      },
    }
    const config: Record<string, unknown> = {
      model: "anthropic/claude-opus-4-6",
      agent: {},
    }
    const handler = createConfigHandler({
      ctx: { directory: "/tmp" },
      pluginConfig,
      modelCacheState: {
        anthropicContext1MEnabled: false,
        modelContextLimitsCache: new Map(),
      },
    })

    // #when
    await handler(config)

    // #then - prompt_append is appended to base prompt, not overwriting it
    const agents = config.agent as Record<string, { prompt?: string }>
    expect(agents.prometheus).toBeDefined()
    expect(agents.prometheus.prompt).toContain("Prometheus")
    expect(agents.prometheus.prompt).toContain(customInstructions)
    expect(agents.prometheus.prompt!.endsWith(customInstructions)).toBe(true)
  })
})

describe("Plan agent model inheritance from prometheus", () => {
  test("plan agent inherits all model-related settings from resolved prometheus config", async () => {
    //#given - prometheus resolves to claude-opus-4-6 with model settings
    spyOn(shared, "resolveModelPipeline" as any).mockReturnValue({
      model: "anthropic/claude-opus-4-6",
      provenance: "provider-fallback",
      variant: "max",
    })
    const pluginConfig: OhMyOpenCodeConfig = {
      sisyphus_agent: {
        planner_enabled: true,
        replace_plan: true,
      },
    }
    const config: Record<string, unknown> = {
      model: "anthropic/claude-opus-4-6",
      agent: {
        plan: {
          name: "plan",
          mode: "primary",
          prompt: "original plan prompt",
        },
      },
    }
    const handler = createConfigHandler({
      ctx: { directory: "/tmp" },
      pluginConfig,
      modelCacheState: {
        anthropicContext1MEnabled: false,
        modelContextLimitsCache: new Map(),
      },
    })

    //#when
    await handler(config)

    //#then - plan inherits model and variant from prometheus, but NOT prompt
    const agents = config.agent as Record<string, { mode?: string; model?: string; variant?: string; prompt?: string }>
    expect(agents.plan).toBeDefined()
    expect(agents.plan.mode).toBe("subagent")
    expect(agents.plan.model).toBe("anthropic/claude-opus-4-6")
    expect(agents.plan.variant).toBe("max")
    expect(agents.plan.prompt).toBeUndefined()
  })

  test("plan agent inherits temperature, reasoningEffort, and other model settings from prometheus", async () => {
    //#given - prometheus configured with category that has temperature and reasoningEffort
    spyOn(shared, "resolveModelPipeline" as any).mockReturnValue({
      model: "openai/gpt-5.2",
      provenance: "override",
      variant: "high",
    })
    const pluginConfig: OhMyOpenCodeConfig = {
      sisyphus_agent: {
        planner_enabled: true,
        replace_plan: true,
      },
      agents: {
        prometheus: {
          model: "openai/gpt-5.2",
          variant: "high",
          temperature: 0.3,
          top_p: 0.9,
          maxTokens: 16000,
          reasoningEffort: "high",
          textVerbosity: "medium",
          thinking: { type: "enabled", budgetTokens: 8000 },
        },
      },
    }
    const config: Record<string, unknown> = {
      model: "anthropic/claude-opus-4-6",
      agent: {},
    }
    const handler = createConfigHandler({
      ctx: { directory: "/tmp" },
      pluginConfig,
      modelCacheState: {
        anthropicContext1MEnabled: false,
        modelContextLimitsCache: new Map(),
      },
    })

    //#when
    await handler(config)

    //#then - plan inherits ALL model-related settings from resolved prometheus
    const agents = config.agent as Record<string, Record<string, unknown>>
    expect(agents.plan).toBeDefined()
    expect(agents.plan.mode).toBe("subagent")
    expect(agents.plan.model).toBe("openai/gpt-5.2")
    expect(agents.plan.variant).toBe("high")
    expect(agents.plan.temperature).toBe(0.3)
    expect(agents.plan.top_p).toBe(0.9)
    expect(agents.plan.maxTokens).toBe(16000)
    expect(agents.plan.reasoningEffort).toBe("high")
    expect(agents.plan.textVerbosity).toBe("medium")
    expect(agents.plan.thinking).toEqual({ type: "enabled", budgetTokens: 8000 })
  })

  test("plan agent user override takes priority over prometheus inherited settings", async () => {
    //#given - prometheus resolves to opus, but user has plan override for gpt-5.2
    spyOn(shared, "resolveModelPipeline" as any).mockReturnValue({
      model: "anthropic/claude-opus-4-6",
      provenance: "provider-fallback",
      variant: "max",
    })
    const pluginConfig: OhMyOpenCodeConfig = {
      sisyphus_agent: {
        planner_enabled: true,
        replace_plan: true,
      },
      agents: {
        plan: {
          model: "openai/gpt-5.2",
          variant: "high",
          temperature: 0.5,
        },
      },
    }
    const config: Record<string, unknown> = {
      model: "anthropic/claude-opus-4-6",
      agent: {},
    }
    const handler = createConfigHandler({
      ctx: { directory: "/tmp" },
      pluginConfig,
      modelCacheState: {
        anthropicContext1MEnabled: false,
        modelContextLimitsCache: new Map(),
      },
    })

    //#when
    await handler(config)

    //#then - plan uses its own override, not prometheus settings
    const agents = config.agent as Record<string, Record<string, unknown>>
    expect(agents.plan.model).toBe("openai/gpt-5.2")
    expect(agents.plan.variant).toBe("high")
    expect(agents.plan.temperature).toBe(0.5)
  })

  test("plan agent does NOT inherit prompt, description, or color from prometheus", async () => {
    //#given
    spyOn(shared, "resolveModelPipeline" as any).mockReturnValue({
      model: "anthropic/claude-opus-4-6",
      provenance: "provider-fallback",
      variant: "max",
    })
    const pluginConfig: OhMyOpenCodeConfig = {
      sisyphus_agent: {
        planner_enabled: true,
        replace_plan: true,
      },
    }
    const config: Record<string, unknown> = {
      model: "anthropic/claude-opus-4-6",
      agent: {},
    }
    const handler = createConfigHandler({
      ctx: { directory: "/tmp" },
      pluginConfig,
      modelCacheState: {
        anthropicContext1MEnabled: false,
        modelContextLimitsCache: new Map(),
      },
    })

    //#when
    await handler(config)

    //#then - plan has model settings but NOT prompt/description/color
    const agents = config.agent as Record<string, Record<string, unknown>>
    expect(agents.plan.model).toBe("anthropic/claude-opus-4-6")
    expect(agents.plan.prompt).toBeUndefined()
    expect(agents.plan.description).toBeUndefined()
    expect(agents.plan.color).toBeUndefined()
  })
})

describe("Deadlock prevention - fetchAvailableModels must not receive client", () => {
  test("fetchAvailableModels should be called with undefined client to prevent deadlock during plugin init", async () => {
    // given - This test ensures we don't regress on issue #1301
    // Passing client to fetchAvailableModels during config handler causes deadlock:
    // - Plugin init waits for server response (client.provider.list())
    // - Server waits for plugin init to complete before handling requests
    const fetchSpy = spyOn(shared, "fetchAvailableModels" as any).mockResolvedValue(new Set<string>())

    const pluginConfig: OhMyOpenCodeConfig = {
      sisyphus_agent: {
        planner_enabled: true,
      },
    }
    const config: Record<string, unknown> = {
      model: "anthropic/claude-opus-4-6",
      agent: {},
    }
    const mockClient = {
      provider: { list: () => Promise.resolve({ data: { connected: [] } }) },
      model: { list: () => Promise.resolve({ data: [] }) },
    }
    const handler = createConfigHandler({
      ctx: { directory: "/tmp", client: mockClient },
      pluginConfig,
      modelCacheState: {
        anthropicContext1MEnabled: false,
        modelContextLimitsCache: new Map(),
      },
    })

    // when
    await handler(config)

    // then - fetchAvailableModels must be called with undefined as first argument (no client)
    // This prevents the deadlock described in issue #1301
    expect(fetchSpy).toHaveBeenCalled()
    const firstCallArgs = fetchSpy.mock.calls[0]
    expect(firstCallArgs[0]).toBeUndefined()

    fetchSpy.mockRestore?.()
  })
})

describe("config-handler plugin loading error boundary (#1559)", () => {
  test("returns empty defaults when loadAllPluginComponents throws", async () => {
    //#given
    ;(pluginLoader.loadAllPluginComponents as any).mockRestore?.()
    spyOn(pluginLoader, "loadAllPluginComponents" as any).mockRejectedValue(new Error("crash"))
    const pluginConfig: OhMyOpenCodeConfig = {}
    const config: Record<string, unknown> = {
      model: "anthropic/claude-opus-4-6",
      agent: {},
    }
    const handler = createConfigHandler({
      ctx: { directory: "/tmp" },
      pluginConfig,
      modelCacheState: {
        anthropicContext1MEnabled: false,
        modelContextLimitsCache: new Map(),
      },
    })

    //#when
    await handler(config)

    //#then
    expect(config.agent).toBeDefined()
  })

  test("returns empty defaults when loadAllPluginComponents times out", async () => {
    //#given
    ;(pluginLoader.loadAllPluginComponents as any).mockRestore?.()
    spyOn(pluginLoader, "loadAllPluginComponents" as any).mockImplementation(
      () => new Promise(() => {})
    )
    const pluginConfig: OhMyOpenCodeConfig = {
      experimental: { plugin_load_timeout_ms: 100 },
    }
    const config: Record<string, unknown> = {
      model: "anthropic/claude-opus-4-6",
      agent: {},
    }
    const handler = createConfigHandler({
      ctx: { directory: "/tmp" },
      pluginConfig,
      modelCacheState: {
        anthropicContext1MEnabled: false,
        modelContextLimitsCache: new Map(),
      },
    })

    //#when
    await handler(config)

    //#then
    expect(config.agent).toBeDefined()
  }, 5000)

  test("logs error when loadAllPluginComponents fails", async () => {
    //#given
    ;(pluginLoader.loadAllPluginComponents as any).mockRestore?.()
    spyOn(pluginLoader, "loadAllPluginComponents" as any).mockRejectedValue(new Error("crash"))
    const logSpy = shared.log as ReturnType<typeof spyOn>
    const pluginConfig: OhMyOpenCodeConfig = {}
    const config: Record<string, unknown> = {
      model: "anthropic/claude-opus-4-6",
      agent: {},
    }
    const handler = createConfigHandler({
      ctx: { directory: "/tmp" },
      pluginConfig,
      modelCacheState: {
        anthropicContext1MEnabled: false,
        modelContextLimitsCache: new Map(),
      },
    })

    //#when
    await handler(config)

    //#then
    const logCalls = logSpy.mock.calls.map((c: unknown[]) => c[0])
    const hasPluginFailureLog = logCalls.some(
      (msg: string) => typeof msg === "string" && msg.includes("Plugin loading failed")
    )
    expect(hasPluginFailureLog).toBe(true)
  })

  test("passes through plugin data on successful load (identity test)", async () => {
    //#given
    ;(pluginLoader.loadAllPluginComponents as any).mockRestore?.()
    spyOn(pluginLoader, "loadAllPluginComponents" as any).mockResolvedValue({
      commands: { "test-cmd": { description: "test", template: "test" } },
      skills: {},
      agents: {},
      mcpServers: {},
      hooksConfigs: [],
      plugins: [{ name: "test-plugin", version: "1.0.0" }],
      errors: [],
    })
    const pluginConfig: OhMyOpenCodeConfig = {}
    const config: Record<string, unknown> = {
      model: "anthropic/claude-opus-4-6",
      agent: {},
    }
    const handler = createConfigHandler({
      ctx: { directory: "/tmp" },
      pluginConfig,
      modelCacheState: {
        anthropicContext1MEnabled: false,
        modelContextLimitsCache: new Map(),
      },
    })

    //#when
    await handler(config)

    //#then
    const commands = config.command as Record<string, unknown>
    expect(commands["test-cmd"]).toBeDefined()
  })
})

describe("per-agent todowrite/todoread deny when task_system enabled", () => {
  const PRIMARY_AGENTS = ["sisyphus", "hephaestus", "atlas", "prometheus", "sisyphus-junior"]

  test("denies todowrite and todoread for primary agents when task_system is enabled", async () => {
    //#given
    const createBuiltinAgentsMock = agents.createBuiltinAgents as unknown as {
      mockResolvedValue: (value: Record<string, unknown>) => void
    }
    createBuiltinAgentsMock.mockResolvedValue({
      sisyphus: { name: "sisyphus", prompt: "test", mode: "primary" },
      hephaestus: { name: "hephaestus", prompt: "test", mode: "primary" },
      atlas: { name: "atlas", prompt: "test", mode: "primary" },
      prometheus: { name: "prometheus", prompt: "test", mode: "primary" },
      "sisyphus-junior": { name: "sisyphus-junior", prompt: "test", mode: "subagent" },
      oracle: { name: "oracle", prompt: "test", mode: "subagent" },
    })

    const pluginConfig: OhMyOpenCodeConfig = {
      experimental: { task_system: true },
    }
    const config: Record<string, unknown> = {
      model: "anthropic/claude-opus-4-6",
      agent: {},
    }
    const handler = createConfigHandler({
      ctx: { directory: "/tmp" },
      pluginConfig,
      modelCacheState: {
        anthropicContext1MEnabled: false,
        modelContextLimitsCache: new Map(),
      },
    })

    //#when
    await handler(config)

    //#then
    const agentResult = config.agent as Record<string, { permission?: Record<string, unknown> }>
    for (const agentName of PRIMARY_AGENTS) {
      expect(agentResult[agentName]?.permission?.todowrite).toBe("deny")
      expect(agentResult[agentName]?.permission?.todoread).toBe("deny")
    }
  })

  test("does not deny todowrite/todoread when task_system is disabled", async () => {
    //#given
    const createBuiltinAgentsMock = agents.createBuiltinAgents as unknown as {
      mockResolvedValue: (value: Record<string, unknown>) => void
    }
    createBuiltinAgentsMock.mockResolvedValue({
      sisyphus: { name: "sisyphus", prompt: "test", mode: "primary" },
      hephaestus: { name: "hephaestus", prompt: "test", mode: "primary" },
    })

    const pluginConfig: OhMyOpenCodeConfig = {
      experimental: { task_system: false },
    }
    const config: Record<string, unknown> = {
      model: "anthropic/claude-opus-4-6",
      agent: {},
    }
    const handler = createConfigHandler({
      ctx: { directory: "/tmp" },
      pluginConfig,
      modelCacheState: {
        anthropicContext1MEnabled: false,
        modelContextLimitsCache: new Map(),
      },
    })

    //#when
    await handler(config)

    //#then
    const agentResult = config.agent as Record<string, { permission?: Record<string, unknown> }>
    expect(agentResult.sisyphus?.permission?.todowrite).toBeUndefined()
    expect(agentResult.sisyphus?.permission?.todoread).toBeUndefined()
    expect(agentResult.hephaestus?.permission?.todowrite).toBeUndefined()
    expect(agentResult.hephaestus?.permission?.todoread).toBeUndefined()
  })

  test("does not deny todowrite/todoread when task_system is undefined", async () => {
    //#given
    const createBuiltinAgentsMock = agents.createBuiltinAgents as unknown as {
      mockResolvedValue: (value: Record<string, unknown>) => void
    }
    createBuiltinAgentsMock.mockResolvedValue({
      sisyphus: { name: "sisyphus", prompt: "test", mode: "primary" },
    })

    const pluginConfig: OhMyOpenCodeConfig = {}
    const config: Record<string, unknown> = {
      model: "anthropic/claude-opus-4-6",
      agent: {},
    }
    const handler = createConfigHandler({
      ctx: { directory: "/tmp" },
      pluginConfig,
      modelCacheState: {
        anthropicContext1MEnabled: false,
        modelContextLimitsCache: new Map(),
      },
    })

    //#when
    await handler(config)

    //#then
    const agentResult = config.agent as Record<string, { permission?: Record<string, unknown> }>
    expect(agentResult.sisyphus?.permission?.todowrite).toBeUndefined()
    expect(agentResult.sisyphus?.permission?.todoread).toBeUndefined()
  })
})
