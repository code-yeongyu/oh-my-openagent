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

  spyOn(sisyphusJunior, "createSisyphusJuniorAgentWithOverrides" as any).mockReturnValue({
    name: "sisyphus-junior",
    prompt: "test",
    mode: "subagent",
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
  spyOn(shared, "fetchAvailableModels" as any).mockResolvedValue(new Set(["anthropic/claude-opus-4-5"]))
  spyOn(shared, "readConnectedProvidersCache" as any).mockReturnValue(null)

  spyOn(configDir, "getOpenCodeConfigPaths" as any).mockReturnValue({
    global: "/tmp/.config/opencode",
    project: "/tmp/.opencode",
  })

  spyOn(permissionCompat, "migrateAgentConfig" as any).mockImplementation((config: Record<string, unknown>) => config)

  spyOn(modelResolver, "resolveModelWithFallback" as any).mockReturnValue({ model: "anthropic/claude-opus-4-5" })
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

describe("Plan agent demote behavior", () => {
  test("plan agent should be demoted to subagent mode when replacePlan is true", async () => {
    // #given
    const pluginConfig: OhMyOpenCodeConfig = {
      sisyphus_agent: {
        planner_enabled: true,
        replace_plan: true,
      },
    }
    const config: Record<string, unknown> = {
      model: "anthropic/claude-opus-4-5",
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

    // #then
    const agents = config.agent as Record<string, { mode?: string; name?: string }>
    expect(agents.plan).toBeDefined()
    expect(agents.plan.mode).toBe("subagent")
    expect(agents.plan.name).toBe("plan")
  })

  test("prometheus should have mode 'all' to be callable via delegate_task", async () => {
    // #given
    const pluginConfig: OhMyOpenCodeConfig = {
      sisyphus_agent: {
        planner_enabled: true,
      },
    }
    const config: Record<string, unknown> = {
      model: "anthropic/claude-opus-4-5",
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
    const agents = config.agent as Record<string, { mode?: string }>
    expect(agents.prometheus).toBeDefined()
    expect(agents.prometheus.mode).toBe("all")
  })
})

describe("Prometheus category config resolution", () => {
  test("resolves ultrabrain category config", () => {
    // #given
    const categoryName = "ultrabrain"

    // #when
    const config = resolveCategoryConfig(categoryName)

    // #then
    expect(config).toBeDefined()
    expect(config?.model).toBe("openai/gpt-5.2-codex")
    expect(config?.variant).toBe("xhigh")
  })

  test("resolves visual-engineering category config", () => {
    // #given
    const categoryName = "visual-engineering"

    // #when
    const config = resolveCategoryConfig(categoryName)

    // #then
    expect(config).toBeDefined()
    expect(config?.model).toBe("google/gemini-3-pro")
  })

  test("user categories override default categories", () => {
    // #given
    const categoryName = "ultrabrain"
    const userCategories: Record<string, CategoryConfig> = {
      ultrabrain: {
        model: "google/antigravity-claude-opus-4-5-thinking",
        temperature: 0.1,
      },
    }

    // #when
    const config = resolveCategoryConfig(categoryName, userCategories)

    // #then
    expect(config).toBeDefined()
    expect(config?.model).toBe("google/antigravity-claude-opus-4-5-thinking")
    expect(config?.temperature).toBe(0.1)
  })

  test("returns undefined for unknown category", () => {
    // #given
    const categoryName = "nonexistent-category"

    // #when
    const config = resolveCategoryConfig(categoryName)

    // #then
    expect(config).toBeUndefined()
  })

  test("falls back to default when user category has no entry", () => {
    // #given
    const categoryName = "ultrabrain"
    const userCategories: Record<string, CategoryConfig> = {
      "visual-engineering": {
        model: "custom/visual-model",
      },
    }

    // #when
    const config = resolveCategoryConfig(categoryName, userCategories)

    // #then - falls back to DEFAULT_CATEGORIES
    expect(config).toBeDefined()
    expect(config?.model).toBe("openai/gpt-5.2-codex")
    expect(config?.variant).toBe("xhigh")
  })

  test("preserves all category properties (temperature, top_p, tools, etc.)", () => {
    // #given
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

    // #when
    const config = resolveCategoryConfig(categoryName, userCategories)

    // #then
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
    // #given - category has reasoningEffort=xhigh, direct override says "low"
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
      model: "anthropic/claude-opus-4-5",
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

    // #then - direct override's reasoningEffort wins
    const agents = config.agent as Record<string, { reasoningEffort?: string }>
    expect(agents.prometheus).toBeDefined()
    expect(agents.prometheus.reasoningEffort).toBe("low")
  })

  test("category reasoningEffort applied when no direct override", async () => {
    // #given - category has reasoningEffort but no direct override
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
      model: "anthropic/claude-opus-4-5",
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

    // #then - category's reasoningEffort is applied
    const agents = config.agent as Record<string, { reasoningEffort?: string }>
    expect(agents.prometheus).toBeDefined()
    expect(agents.prometheus.reasoningEffort).toBe("high")
  })

  test("direct temperature takes priority over category temperature", async () => {
    // #given
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
      model: "anthropic/claude-opus-4-5",
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

    // #then - direct temperature wins over category
    const agents = config.agent as Record<string, { temperature?: number }>
    expect(agents.prometheus).toBeDefined()
    expect(agents.prometheus.temperature).toBe(0.1)
  })
})

describe("Deadlock prevention - fetchAvailableModels must not receive client", () => {
  test("fetchAvailableModels should be called with undefined client to prevent deadlock during plugin init", async () => {
    // #given - This test ensures we don't regress on issue #1301
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
      model: "anthropic/claude-opus-4-5",
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

    // #when
    await handler(config)

    // #then - fetchAvailableModels must be called with undefined as first argument (no client)
    // This prevents the deadlock described in issue #1301
    expect(fetchSpy).toHaveBeenCalled()
    const firstCallArgs = fetchSpy.mock.calls[0]
    expect(firstCallArgs[0]).toBeUndefined()

    fetchSpy.mockRestore?.()
  })
})
