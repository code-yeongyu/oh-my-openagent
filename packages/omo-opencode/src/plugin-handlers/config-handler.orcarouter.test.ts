/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"

import type { OhMyOpenCodeConfig } from "../config"
import type { ModelCacheState } from "../plugin-state"
import * as agents from "../agents"
import * as agentLoader from "../features/claude-code-agent-loader"
import * as builtinCommands from "../features/builtin-commands"
import * as commandLoader from "../features/claude-code-command-loader"
import * as mcpLoader from "../features/claude-code-mcp-loader"
import * as mcpModule from "../mcp"
import * as pluginLoader from "../features/claude-code-plugin-loader"
import * as shared from "../shared"
import * as skillLoader from "../features/opencode-skill-loader"
import * as configDir from "../shared/opencode-config-dir"
import * as modelResolver from "../shared/model-resolver"
import * as permissionCompat from "../shared/permission-compat"
import { ORCAROUTER_ENV_VAR, ORCAROUTER_PROVIDER_ID } from "../features/orcarouter-provider"
import { _resetProviderAuthCacheForTesting } from "../shared/opencode-provider-auth"
import { unsafeTestValue } from "../../../../test-support/unsafe-test-value"

let createConfigHandler: (typeof import("./config-handler"))["createConfigHandler"]

function createModelCacheState(): ModelCacheState {
  return {
    anthropicContext1MEnabled: false,
    modelContextLimitsCache: new Map<string, number>(),
  }
}

function createPluginConfig(): OhMyOpenCodeConfig {
  return {
    git_master: {
      commit_footer: true,
      include_co_authored_by: true,
      git_env_prefix: "GIT_MASTER=1",
    },
  }
}

describe("config handler OrcaRouter provider injection", () => {
  const originalApiKey = process.env[ORCAROUTER_ENV_VAR]
  const originalXdgDataHome = process.env.XDG_DATA_HOME
  let tempDataDir: string

  beforeEach(async () => {
    mock.restore()
    tempDataDir = mkdtempSync(path.join(tmpdir(), "orcarouter-config-handler-"))
    process.env.XDG_DATA_HOME = tempDataDir
    _resetProviderAuthCacheForTesting()

    spyOn(agents, unsafeTestValue("createBuiltinAgents")).mockResolvedValue({
      sisyphus: { name: "sisyphus", prompt: "test", mode: "primary" },
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
      omoConfig: "/tmp/.config/opencode/omo.jsonc",
    })
    spyOn(permissionCompat, unsafeTestValue("migrateAgentConfig")).mockImplementation(
      (config: Record<string, unknown>) => config,
    )
    spyOn(modelResolver, unsafeTestValue("resolveModelWithFallback")).mockReturnValue({
      model: "anthropic/claude-opus-4-7",
      source: "provider-fallback",
    })
    ;({ createConfigHandler } = await import(`./config-handler?orcarouter=${Date.now()}-${Math.random()}`))
  })

  afterEach(() => {
    if (originalApiKey === undefined) {
      delete process.env[ORCAROUTER_ENV_VAR]
    } else {
      process.env[ORCAROUTER_ENV_VAR] = originalApiKey
    }
    if (originalXdgDataHome === undefined) {
      delete process.env.XDG_DATA_HOME
    } else {
      process.env.XDG_DATA_HOME = originalXdgDataHome
    }
    rmSync(tempDataDir, { recursive: true, force: true })
    _resetProviderAuthCacheForTesting()
    mock.restore()
  })

  test("registers the provider before provider model limits are harvested", async () => {
    // given the OrcaRouter API key present and a config with no provider block
    process.env[ORCAROUTER_ENV_VAR] = "sk-orcarouter-test"
    const modelCacheState = createModelCacheState()
    const config: Record<string, unknown> = { model: "anthropic/claude-opus-4-7", agent: {} }
    const handler = createConfigHandler({
      ctx: { directory: "/tmp" },
      pluginConfig: createPluginConfig(),
      modelCacheState,
    })

    // when the config hook runs
    await handler(config)

    // then the provider is registered and its context limits already reached the cache
    const providers = config.provider as Record<string, unknown> | undefined
    expect(providers?.[ORCAROUTER_PROVIDER_ID]).toBeDefined()
    const cachedOrcaRouterKeys = [...modelCacheState.modelContextLimitsCache.keys()].filter((key) =>
      key.startsWith(`${ORCAROUTER_PROVIDER_ID}/`),
    )
    expect(cachedOrcaRouterKeys.length).toBeGreaterThanOrEqual(4)
  })

  test("leaves the provider block absent when no credential is available", async () => {
    // given no OrcaRouter credential in the environment
    delete process.env[ORCAROUTER_ENV_VAR]
    const modelCacheState = createModelCacheState()
    const config: Record<string, unknown> = { model: "anthropic/claude-opus-4-7", agent: {} }
    const handler = createConfigHandler({
      ctx: { directory: "/tmp" },
      pluginConfig: createPluginConfig(),
      modelCacheState,
    })

    // when the config hook runs
    await handler(config)

    // then no orcarouter provider or model limit is registered
    const providers = config.provider as Record<string, unknown> | undefined
    expect(providers?.[ORCAROUTER_PROVIDER_ID]).toBeUndefined()
    expect(
      [...modelCacheState.modelContextLimitsCache.keys()].some((key) =>
        key.startsWith(`${ORCAROUTER_PROVIDER_ID}/`),
      ),
    ).toBe(false)
  })
})
