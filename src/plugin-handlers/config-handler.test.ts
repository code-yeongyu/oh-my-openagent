import { describe, test, expect, mock, beforeEach } from "bun:test"
import { createConfigHandler } from "./config-handler"
import type { OhMyOpenCodeConfig } from "../config"

// Mock the external dependencies
mock.module("../features/claude-code-command-loader", () => ({
  loadUserCommands: () => ({}),
  loadProjectCommands: () => ({}),
  loadOpencodeGlobalCommands: () => ({}),
  loadOpencodeProjectCommands: () => ({}),
}))

mock.module("../features/builtin-commands", () => ({
  loadBuiltinCommands: () => ({}),
}))

mock.module("../features/opencode-skill-loader", () => ({
  loadUserSkills: () => ({}),
  loadProjectSkills: () => ({}),
  loadOpencodeGlobalSkills: () => ({}),
  loadOpencodeProjectSkills: () => ({}),
}))

mock.module("../features/claude-code-agent-loader", () => ({
  loadUserAgents: () => ({}),
  loadProjectAgents: () => ({}),
}))

mock.module("../features/claude-code-mcp-loader", () => ({
  loadMcpConfigs: () => ({ servers: {} }),
}))

mock.module("../features/claude-code-plugin-loader", () => ({
  loadAllPluginComponents: () => ({
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

describe("createConfigHandler - agent model override precedence", () => {
  const mockCtx = { directory: "/test/project" }
  const mockModelCacheState = {
    anthropicContext1MEnabled: false,
    modelContextLimitsCache: new Map<string, number>(),
  }

  beforeEach(() => {
    mockModelCacheState.anthropicContext1MEnabled = false
    mockModelCacheState.modelContextLimitsCache.clear()
  })

  test("oh-my-opencode agent model override takes precedence over OpenCode default", async () => {
    // #given - user sets explore model to gemini in oh-my-opencode config
    const pluginConfig: OhMyOpenCodeConfig = {
      agents: {
        explore: { model: "google/gemini-3-flash" },
      },
    }

    // OpenCode's config.agent has explore with a different model (simulating OpenCode's default)
    const openCodeConfig: Record<string, unknown> = {
      model: "anthropic/claude-sonnet-4",
      agent: {
        explore: {
          model: "anthropic/claude-3.5-sonnet",
          description: "OpenCode default explore agent",
        },
      },
    }

    const handler = createConfigHandler({
      ctx: mockCtx,
      pluginConfig,
      modelCacheState: mockModelCacheState,
    })

    // #when
    await handler(openCodeConfig)

    // #then - oh-my-opencode's model should win
    const resultAgent = openCodeConfig.agent as Record<string, Record<string, unknown>>
    expect(resultAgent.explore).toBeDefined()
    expect(resultAgent.explore.model).toBe("google/gemini-3-flash")
  })

  test("oh-my-opencode agent settings preserved when OpenCode defines same agent", async () => {
    // #given - user sets librarian model in oh-my-opencode config
    const pluginConfig: OhMyOpenCodeConfig = {
      agents: {
        librarian: { model: "openai/gpt-5" },
      },
    }

    // OpenCode's config.agent has librarian with different settings
    const openCodeConfig: Record<string, unknown> = {
      model: "anthropic/claude-sonnet-4",
      agent: {
        librarian: {
          model: "anthropic/claude-haiku-3",
          temperature: 0.9,
        },
      },
    }

    const handler = createConfigHandler({
      ctx: mockCtx,
      pluginConfig,
      modelCacheState: mockModelCacheState,
    })

    // #when
    await handler(openCodeConfig)

    // #then - oh-my-opencode's model should win
    const resultAgent = openCodeConfig.agent as Record<string, Record<string, unknown>>
    expect(resultAgent.librarian).toBeDefined()
    expect(resultAgent.librarian.model).toBe("openai/gpt-5")
  })

  test("OpenCode custom agents not in builtinAgents are preserved", async () => {
    // #given - user has no overrides
    const pluginConfig: OhMyOpenCodeConfig = {}

    // OpenCode's config.agent has a custom agent
    const openCodeConfig: Record<string, unknown> = {
      model: "anthropic/claude-sonnet-4",
      agent: {
        "my-custom-agent": {
          model: "openai/gpt-4",
          description: "My custom agent",
        },
        explore: {
          model: "anthropic/claude-3.5-sonnet",
        },
      },
    }

    const handler = createConfigHandler({
      ctx: mockCtx,
      pluginConfig,
      modelCacheState: mockModelCacheState,
    })

    // #when
    await handler(openCodeConfig)

    // #then - custom agent should be preserved
    const resultAgent = openCodeConfig.agent as Record<string, Record<string, unknown>>
    expect(resultAgent["my-custom-agent"]).toBeDefined()
    expect(resultAgent["my-custom-agent"].model).toBe("openai/gpt-4")
    // explore should use oh-my-opencode's default (opencode/grok-code), not OpenCode's override
    expect(resultAgent.explore.model).toBe("opencode/grok-code")
  })

  test("Sisyphus disabled: agent model override still takes precedence", async () => {
    // #given - Sisyphus disabled, user sets explore model
    const pluginConfig: OhMyOpenCodeConfig = {
      sisyphus_agent: { disabled: true },
      agents: {
        explore: { model: "google/gemini-3-pro" },
      },
    }

    // OpenCode's config.agent has explore with different model
    const openCodeConfig: Record<string, unknown> = {
      model: "anthropic/claude-sonnet-4",
      agent: {
        explore: {
          model: "anthropic/claude-3.5-sonnet",
        },
      },
    }

    const handler = createConfigHandler({
      ctx: mockCtx,
      pluginConfig,
      modelCacheState: mockModelCacheState,
    })

    // #when
    await handler(openCodeConfig)

    // #then - oh-my-opencode's model should win even when Sisyphus is disabled
    const resultAgent = openCodeConfig.agent as Record<string, Record<string, unknown>>
    expect(resultAgent.explore).toBeDefined()
    expect(resultAgent.explore.model).toBe("google/gemini-3-pro")
  })
})
