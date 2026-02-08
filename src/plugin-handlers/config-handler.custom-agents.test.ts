import { describe, expect, spyOn, test } from "bun:test"
import { createConfigHandler } from "./config-handler"
import type { OhMyOpenCodeConfig } from "../config"

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

const TEST_DEFAULT_MODEL = "anthropic/claude-opus-4-6"

describe("Issue #1623: custom agents visible to orchestrators", () => {
  test("injects .opencode/agents into Sisyphus prompt available agent list", async () => {
    // #given
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
    spyOn(mcpModule, "createBuiltinMcps" as any).mockReturnValue({})

    spyOn(pluginLoader, "loadAllPluginComponents" as any).mockResolvedValue({
      commands: {},
      skills: {},
      agents: {},
      mcpServers: {},
      hooksConfigs: [],
      plugins: [],
      errors: [],
    })

    spyOn(shared, "log" as any).mockImplementation(() => {})
    spyOn(shared, "readConnectedProvidersCache" as any).mockReturnValue(null)
    spyOn(shared, "fetchAvailableModels" as any).mockResolvedValue(
      new Set([TEST_DEFAULT_MODEL, "openai/gpt-5.2", "anthropic/claude-sonnet-4-5"])
    )

    spyOn(configDir, "getOpenCodeConfigPaths" as any).mockReturnValue({
      global: "/tmp/.config/opencode",
      project: "/tmp/.opencode",
    })

    spyOn(permissionCompat, "migrateAgentConfig" as any).mockImplementation((config: Record<string, unknown>) => config)

    const pluginConfig: OhMyOpenCodeConfig = {}
    const config: Record<string, unknown> = {
      model: TEST_DEFAULT_MODEL,
      agent: {
        researcher: {
          name: "researcher",
          mode: "subagent",
          description: "Research agent for deep analysis",
          prompt: "You are a research agent...",
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
    const agents = config.agent as Record<string, { prompt?: string }>
    expect(agents.sisyphus?.prompt).toBeDefined()
    expect(agents.sisyphus?.prompt).toContain("`researcher`")
  })
})
