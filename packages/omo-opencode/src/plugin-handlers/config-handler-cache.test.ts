/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import type { OhMyOpenCodeConfig } from "../config"
import * as agents from "../agents"
import * as commandLoader from "../features/claude-code-command-loader"
import { isAgentRegistered } from "../features/claude-code-session-state"
import * as builtinCommands from "../features/builtin-commands"
import * as skillLoader from "../features/opencode-skill-loader"
import * as agentLoader from "../features/claude-code-agent-loader"
import * as mcpLoader from "../features/claude-code-mcp-loader"
import * as pluginLoader from "../features/claude-code-plugin-loader"
import * as mcpModule from "../mcp"
import * as shared from "../shared"
import { getAgentListDisplayName } from "../shared/agent-display-names"
import { installAgentSortShim, setAgentSortOrder } from "../shared/agent-sort-shim"
import * as configDir from "../shared/opencode-config-dir"
import * as permissionCompat from "../shared/permission-compat"
import * as modelResolver from "../shared/model-resolver"
import * as configErrors from "../shared/config-errors"
import { unsafeTestValue } from "../../../../test-support/unsafe-test-value"

let createConfigHandler: (typeof import("./config-handler"))["createConfigHandler"]

async function importFreshConfigHandlerModule(): Promise<typeof import("./config-handler")> {
  return import(`./config-handler?test=${Date.now()}-${Math.random()}`)
}

function createPluginConfig(overrides: Partial<OhMyOpenCodeConfig> = {}): OhMyOpenCodeConfig {
  return {
    git_master: {
      commit_footer: true,
      include_co_authored_by: true,
      git_env_prefix: "GIT_MASTER=1",
    },
    ...overrides,
  }
}

beforeEach(async () => {
  mock.restore()
  configErrors.clearConfigLoadErrors()

  spyOn(agents, unsafeTestValue("createBuiltinAgents")).mockResolvedValue({
    sisyphus: { name: "sisyphus", prompt: "test", mode: "primary" },
    oracle: { name: "oracle", prompt: "test", mode: "subagent" },
  })

  spyOn(commandLoader, unsafeTestValue("loadUserCommands")).mockResolvedValue({})
  spyOn(commandLoader, unsafeTestValue("loadProjectCommands")).mockResolvedValue({})
  spyOn(commandLoader, unsafeTestValue("loadOpencodeGlobalCommands")).mockResolvedValue({})
  spyOn(commandLoader, unsafeTestValue("loadOpencodeProjectCommands")).mockResolvedValue({})
  spyOn(builtinCommands, unsafeTestValue("loadBuiltinCommands")).mockReturnValue({})
  spyOn(skillLoader, unsafeTestValue("loadUserSkills")).mockResolvedValue({})
  spyOn(skillLoader, unsafeTestValue("loadProjectSkills")).mockResolvedValue({})
  spyOn(skillLoader, unsafeTestValue("loadOpencodeGlobalSkills")).mockResolvedValue({})
  spyOn(skillLoader, unsafeTestValue("loadOpencodeProjectSkills")).mockResolvedValue({})
  spyOn(skillLoader, unsafeTestValue("discoverUserClaudeSkills")).mockResolvedValue([])
  spyOn(skillLoader, unsafeTestValue("discoverProjectClaudeSkills")).mockResolvedValue([])
  spyOn(skillLoader, unsafeTestValue("discoverOpencodeGlobalSkills")).mockResolvedValue([])
  spyOn(skillLoader, unsafeTestValue("discoverOpencodeProjectSkills")).mockResolvedValue([])
  spyOn(agentLoader, unsafeTestValue("loadUserAgents")).mockReturnValue({})
  spyOn(agentLoader, unsafeTestValue("loadProjectAgents")).mockReturnValue({})
  spyOn(agentLoader, unsafeTestValue("loadOpencodeGlobalAgents")).mockReturnValue({})
  spyOn(agentLoader, unsafeTestValue("loadOpencodeProjectAgents")).mockReturnValue({})
  spyOn(mcpLoader, unsafeTestValue("loadMcpConfigs")).mockResolvedValue({ servers: {}, loadedServers: [] })
  spyOn(mcpLoader, "setAdditionalAllowedMcpEnvVars").mockImplementation(() => {})
  spyOn(pluginLoader, unsafeTestValue("loadAllPluginComponents")).mockResolvedValue({
    commands: {},
    skills: {},
    agents: {},
    mcpServers: {},
    hooksConfigs: [],
    plugins: [],
    errors: [],
  })
  spyOn(mcpModule, unsafeTestValue("createBuiltinMcps")).mockReturnValue({})
  spyOn(shared, unsafeTestValue("log")).mockImplementation(() => {})
  spyOn(shared, unsafeTestValue("fetchAvailableModels")).mockResolvedValue(new Set(["anthropic/claude-opus-4-7"]))
  spyOn(shared, unsafeTestValue("readConnectedProvidersCache")).mockReturnValue(null)
  spyOn(configDir, unsafeTestValue("getOpenCodeConfigPaths")).mockReturnValue({
    configDir: "/tmp/.config/opencode",
    configJson: "/tmp/.config/opencode/opencode.json",
    configJsonc: "/tmp/.config/opencode/opencode.jsonc",
    packageJson: "/tmp/.config/opencode/package.json",
    omoConfig: "/tmp/.config/opencode/oh-my-opencode.jsonc",
  })
  spyOn(permissionCompat, unsafeTestValue("migrateAgentConfig")).mockImplementation((config: Record<string, unknown>) => config)

  spyOn(modelResolver, unsafeTestValue("resolveModelWithFallback")).mockReturnValue({
    model: "anthropic/claude-opus-4-7",
    source: "provider-fallback",
  })
  ;({ createConfigHandler } = await importFreshConfigHandlerModule())
})

afterEach(() => {
  setAgentSortOrder(undefined)
  configErrors.clearConfigLoadErrors()
  mock.restore()
})

describe("Config handler hot path caching", () => {
  test("reuses the resolved agent roster for repeated config hook invocations with the same model", async () => {
    // #given
    const pluginConfig = createPluginConfig({
      agents: Object.fromEntries(
        Array.from({ length: 12 }, (_, index) => [
          `agent-${index}`,
          {
            model: `provider/model-${index}`,
            fallback_models: [`provider/fallback-${index}`],
          },
        ]),
      ),
      categories: Object.fromEntries(
        Array.from({ length: 10 }, (_, index) => [
          `category-${index}`,
          {
            model: `provider/category-model-${index}`,
            fallback_models: [`provider/category-fallback-${index}`],
          },
        ]),
      ),
    })
    const handler = createConfigHandler({
      ctx: { directory: "/tmp" },
      pluginConfig,
      modelCacheState: {
        anthropicContext1MEnabled: false,
        modelContextLimitsCache: new Map(),
      },
    })

    // #when
    await handler({ model: "anthropic/claude-opus-4-7", agent: {} })
    await handler({ model: "anthropic/claude-opus-4-7", agent: {} })

    // #then
    expect(unsafeTestValue(agents.createBuiltinAgents).mock.calls).toHaveLength(1)
    expect(isAgentRegistered(getAgentListDisplayName("sisyphus"))).toBe(true)
  })

  test("re-resolves the agent roster when host skill paths change", async () => {
    // #given
    const pluginConfig = createPluginConfig({})
    const handler = createConfigHandler({
      ctx: { directory: "/tmp" },
      pluginConfig,
      modelCacheState: {
        anthropicContext1MEnabled: false,
        modelContextLimitsCache: new Map(),
      },
    })

    // #when
    await handler({
      model: "anthropic/claude-opus-4-7",
      agent: {},
      skills: { paths: ["/tmp/first-sibling-plugin-skills"] },
    })
    await handler({
      model: "anthropic/claude-opus-4-7",
      agent: {},
      skills: { paths: ["/tmp/second-sibling-plugin-skills"] },
    })

    // #then
    expect(unsafeTestValue(agents.createBuiltinAgents).mock.calls).toHaveLength(2)
  })

  test("preserves agent_order on cache hits when default_agent is only a fallback", async () => {
    // #given
    installAgentSortShim()
    const pluginConfig = createPluginConfig({
      agent_order: ["hephaestus", "sisyphus", "prometheus", "atlas"],
    })
    setAgentSortOrder(pluginConfig.agent_order)
    const createBuiltinAgentsMock = unsafeTestValue<{
      mockResolvedValue: (value: Record<string, unknown>) => void
    }>(agents.createBuiltinAgents)
    createBuiltinAgentsMock.mockResolvedValue({
      sisyphus: { name: "sisyphus", prompt: "test", mode: "primary" },
      hephaestus: { name: "hephaestus", prompt: "test", mode: "primary" },
      atlas: { name: "atlas", prompt: "test", mode: "primary" },
    })
    const handler = createConfigHandler({
      ctx: { directory: "/tmp" },
      pluginConfig,
      modelCacheState: {
        anthropicContext1MEnabled: false,
        modelContextLimitsCache: new Map(),
      },
    })

    // #when
    await handler({ model: "anthropic/claude-opus-4-7", agent: {} })
    await handler({ model: "anthropic/claude-opus-4-7", agent: {} })
    const sortedNames = [
      { name: getAgentListDisplayName("atlas") },
      { name: getAgentListDisplayName("sisyphus") },
      { name: getAgentListDisplayName("prometheus") },
      { name: getAgentListDisplayName("hephaestus") },
    ].toSorted((left, right) => left.name.localeCompare(right.name)).map((agent) => agent.name)

    // #then
    expect(sortedNames).toEqual([
      getAgentListDisplayName("hephaestus"),
      getAgentListDisplayName("sisyphus"),
      getAgentListDisplayName("prometheus"),
      getAgentListDisplayName("atlas"),
    ])
  })
})
