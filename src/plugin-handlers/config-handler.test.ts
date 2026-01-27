import { describe, test, expect, mock, beforeEach } from "bun:test"
import { resolveCategoryConfig, createConfigHandler } from "./config-handler"
import type { CategoryConfig } from "../config/schema"
import type { OhMyOpenCodeConfig } from "../config"

mock.module("../agents", () => ({
  createBuiltinAgents: async () => ({
    sisyphus: { name: "sisyphus", prompt: "test", mode: "primary" },
    oracle: { name: "oracle", prompt: "test", mode: "subagent" },
  }),
}))

mock.module("../agents/sisyphus-junior", () => ({
  createSisyphusJuniorAgentWithOverrides: () => ({
    name: "sisyphus-junior",
    prompt: "test",
    mode: "subagent",
  }),
}))

mock.module("../features/claude-code-command-loader", () => ({
  loadUserCommands: async () => ({}),
  loadProjectCommands: async () => ({}),
  loadOpencodeGlobalCommands: async () => ({}),
  loadOpencodeProjectCommands: async () => ({}),
}))

mock.module("../features/builtin-commands", () => ({
  loadBuiltinCommands: () => ({}),
}))

mock.module("../features/opencode-skill-loader", () => ({
  loadUserSkills: async () => ({}),
  loadProjectSkills: async () => ({}),
  loadOpencodeGlobalSkills: async () => ({}),
  loadOpencodeProjectSkills: async () => ({}),
  discoverUserClaudeSkills: async () => [],
  discoverProjectClaudeSkills: async () => [],
  discoverOpencodeGlobalSkills: async () => [],
  discoverOpencodeProjectSkills: async () => [],
}))

mock.module("../features/claude-code-agent-loader", () => ({
  loadUserAgents: () => ({}),
  loadProjectAgents: () => ({}),
}))

mock.module("../features/claude-code-mcp-loader", () => ({
  loadMcpConfigs: async () => ({ servers: {} }),
}))

mock.module("../features/claude-code-plugin-loader", () => ({
  loadAllPluginComponents: async () => ({
    commands: {},
    skills: {},
    agents: {},
    mcpServers: {},
    hooksConfigs: [],
    plugins: [],
    errors: [],
  }),
}))

mock.module("../mcp", () => ({
  createBuiltinMcps: () => ({}),
}))

mock.module("../shared", () => ({
  log: () => {},
  fetchAvailableModels: async () => new Set(["anthropic/claude-opus-4-5"]),
  readConnectedProvidersCache: () => null,
}))

mock.module("../shared/opencode-config-dir", () => ({
  getOpenCodeConfigPaths: () => ({
    global: "/tmp/.config/opencode",
    project: "/tmp/.opencode",
  }),
}))

mock.module("../shared/permission-compat", () => ({
  migrateAgentConfig: (config: Record<string, unknown>) => config,
}))

mock.module("../shared/migration", () => ({
  AGENT_NAME_MAP: {},
}))

mock.module("../shared/model-resolver", () => ({
  resolveModelWithFallback: () => ({ model: "anthropic/claude-opus-4-5" }),
}))

mock.module("../shared/model-requirements", () => ({
  AGENT_MODEL_REQUIREMENTS: {
    prometheus: { fallbackChain: [{ providers: ["anthropic"], model: "claude-opus-4-5" }] },
  },
}))

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
