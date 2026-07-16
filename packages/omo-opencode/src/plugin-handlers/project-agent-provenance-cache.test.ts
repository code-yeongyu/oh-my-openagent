/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"

import type { OhMyOpenCodeConfig } from "../config"
import * as agents from "../agents"
import * as commandLoader from "../features/claude-code-command-loader"
import * as agentLoader from "../features/claude-code-agent-loader"
import * as mcpLoader from "../features/claude-code-mcp-loader"
import * as pluginLoader from "../features/claude-code-plugin-loader"
import {
  hasProjectAgentProvenance,
  replaceProjectAgentProvenance,
} from "../features/team-mode/final-open-code-agent-registry"
import * as builtinCommands from "../features/builtin-commands"
import * as skillLoader from "../features/opencode-skill-loader"
import * as mcpModule from "../mcp"
import * as shared from "../shared"
import * as configErrors from "../shared/config-errors"
import * as configDir from "../shared/opencode-config-dir"
import * as permissionCompat from "../shared/permission-compat"
import * as modelResolver from "../shared/model-resolver"
import { unsafeTestValue } from "../../../../test-support/unsafe-test-value"

let createConfigHandler: (typeof import("./config-handler"))["createConfigHandler"]

function createPluginConfig(): OhMyOpenCodeConfig {
  return {
    git_master: {
      commit_footer: true,
      include_co_authored_by: true,
      git_env_prefix: "GIT_MASTER=1",
    },
  }
}

async function importFreshConfigHandlerModule(): Promise<typeof import("./config-handler")> {
  return import(`./config-handler?provenance-test=${Date.now()}-${Math.random()}`)
}

beforeEach(async () => {
  mock.restore()
  configErrors.clearConfigLoadErrors()
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
  spyOn(agentLoader, unsafeTestValue("readOpencodeConfigAgents")).mockReturnValue({})
  spyOn(mcpLoader, unsafeTestValue("loadMcpConfigs")).mockResolvedValue({ servers: {}, loadedServers: [] })
  spyOn(mcpLoader, "setAdditionalAllowedMcpEnvVars").mockImplementation(() => {})
  spyOn(pluginLoader, unsafeTestValue("loadAllPluginComponents")).mockResolvedValue({
    commands: {}, skills: {}, agents: {}, mcpServers: {}, hooksConfigs: [], plugins: [], errors: [],
  })
  spyOn(mcpModule, unsafeTestValue("createBuiltinMcps")).mockReturnValue({})
  spyOn(shared, unsafeTestValue("log")).mockImplementation(() => {})
  spyOn(shared, unsafeTestValue("fetchAvailableModels")).mockResolvedValue(new Set())
  spyOn(shared, unsafeTestValue("readConnectedProvidersCache")).mockReturnValue(null)
  spyOn(configDir, unsafeTestValue("getOpenCodeConfigPaths")).mockReturnValue({
    configDir: "/tmp/.config/opencode",
    configJson: "/tmp/.config/opencode/opencode.json",
    configJsonc: "/tmp/.config/opencode/opencode.jsonc",
    packageJson: "/tmp/.config/opencode/package.json",
    omoConfig: "/tmp/.config/opencode/oh-my-opencode.jsonc",
  })
  spyOn(permissionCompat, unsafeTestValue("migrateAgentConfig")).mockImplementation(
    (config: Record<string, unknown>) => config,
  )
  spyOn(modelResolver, unsafeTestValue("resolveModelWithFallback")).mockReturnValue({
    model: "openai/gpt-5.4-mini",
    source: "provider-fallback",
  })
  ;({ createConfigHandler } = await importFreshConfigHandlerModule())
})

afterEach(() => {
  configErrors.clearConfigLoadErrors()
  mock.restore()
})

function createHandler(directory: string) {
  return createConfigHandler({
    ctx: { directory },
    pluginConfig: createPluginConfig(),
    modelCacheState: {
      anthropicContext1MEnabled: false,
      modelContextLimitsCache: new Map(),
    },
  })
}

describe("project agent provenance snapshots", () => {
  test("captures the exact directory project source without leaking to another directory", async () => {
    // given
    const directory = "/tmp/provenance-project-a"
    unsafeTestValue(agentLoader.loadOpencodeProjectAgents).mockReturnValue({
      "project-worker": { mode: "subagent" },
    })

    // when
    await createHandler(directory)({
      model: "openai/gpt-5.4-mini",
      agent: { "project-worker": { mode: "subagent" } },
    })

    // then
    expect(hasProjectAgentProvenance(directory, "project-worker")).toBe(true)
    expect(hasProjectAgentProvenance("/tmp/provenance-project-b", "project-worker")).toBe(false)
  })

  test("rejects same-name later sources and unattributed host config entries", async () => {
    // given
    const laterSourceDirectory = "/tmp/provenance-later-source"
    unsafeTestValue(agentLoader.loadOpencodeProjectAgents).mockReturnValue({
      "project-worker": { mode: "subagent" },
    })
    unsafeTestValue(agentLoader.readOpencodeConfigAgents).mockReturnValue({
      "project-worker": { mode: "subagent", description: "later source" },
    })

    // when
    await createHandler(laterSourceDirectory)({ model: "openai/gpt-5.4-mini", agent: {} })
    unsafeTestValue(agentLoader.loadOpencodeProjectAgents).mockReturnValue({})
    unsafeTestValue(agentLoader.readOpencodeConfigAgents).mockReturnValue({})
    const configDirectory = "/tmp/provenance-host-config"
    await createHandler(configDirectory)({
      model: "openai/gpt-5.4-mini",
      agent: { "project-worker": { mode: "subagent" } },
    })

    // then
    expect(hasProjectAgentProvenance(laterSourceDirectory, "project-worker")).toBe(false)
    expect(hasProjectAgentProvenance(configDirectory, "project-worker")).toBe(false)
  })

  test("replays provenance from the agent config cache snapshot", async () => {
    // given
    const directory = "/tmp/provenance-cache-replay"
    unsafeTestValue(agentLoader.loadOpencodeProjectAgents).mockReturnValue({
      "project-worker": { mode: "subagent" },
    })
    const handler = createHandler(directory)
    const hostAgent = { "project-worker": { mode: "subagent" } }
    await handler({ model: "openai/gpt-5.4-mini", agent: hostAgent })
    replaceProjectAgentProvenance(directory, [])

    // when
    await handler({ model: "openai/gpt-5.4-mini", agent: hostAgent })

    // then
    expect(hasProjectAgentProvenance(directory, "project-worker")).toBe(true)
    expect(unsafeTestValue(agentLoader.loadOpencodeProjectAgents).mock.calls).toHaveLength(1)
  })

  test("replaces stale provenance with an empty cold-path snapshot", async () => {
    // given
    const directory = "/tmp/provenance-stale-replacement"
    unsafeTestValue(agentLoader.loadOpencodeProjectAgents).mockReturnValue({
      "project-worker": { mode: "subagent" },
    })
    const handler = createHandler(directory)
    const hostAgent = { "project-worker": { mode: "subagent" } }
    await handler({ model: "openai/gpt-5.4-mini", agent: hostAgent })
    unsafeTestValue(agentLoader.loadOpencodeProjectAgents).mockReturnValue({})

    // when
    await handler({ model: "openai/gpt-5.5", agent: hostAgent })

    // then
    expect(hasProjectAgentProvenance(directory, "project-worker")).toBe(false)
  })

  test("clears stale provenance when a cold agent config refresh fails", async () => {
    // given
    const directory = "/tmp/provenance-failed-refresh"
    const hostAgent = { "project-worker": { mode: "subagent" } }
    unsafeTestValue(agentLoader.loadOpencodeProjectAgents).mockReturnValue(hostAgent)
    const handler = createHandler(directory)
    await handler({ model: "openai/gpt-5.4-mini", agent: hostAgent })
    unsafeTestValue(agents.createBuiltinAgents).mockRejectedValueOnce(
      new Error("cold agent refresh failed"),
    )

    // when
    const refresh = handler({ model: "openai/gpt-5.5", agent: hostAgent })

    // then
    await expect(refresh).rejects.toThrow("cold agent refresh failed")
    expect(hasProjectAgentProvenance(directory, "project-worker")).toBe(false)
  })
})
