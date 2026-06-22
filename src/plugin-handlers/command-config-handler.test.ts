/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import type { MatrixxConfig } from "../config"

import * as builtinCommandsModule from "../features/builtin-commands"
import * as ccCommandLoaderModule from "../features/claude-code-command-loader"
import * as opencodeSkillLoaderModule from "../features/opencode-skill-loader"
import * as skillDefinitionRecordModule from "../features/opencode-skill-loader/skill-definition-record"

let loadBuiltinCommandsSpy: ReturnType<typeof spyOn>
let loadUserCommandsSpy: ReturnType<typeof spyOn>
let loadProjectCommandsSpy: ReturnType<typeof spyOn>
let loadOpencodeGlobalCommandsSpy: ReturnType<typeof spyOn>
let loadOpencodeProjectCommandsSpy: ReturnType<typeof spyOn>
let discoverConfigSourceSkillsSpy: ReturnType<typeof spyOn>
let loadUserSkillsSpy: ReturnType<typeof spyOn>
let loadProjectSkillsSpy: ReturnType<typeof spyOn>
let loadOpencodeGlobalSkillsSpy: ReturnType<typeof spyOn>
let loadOpencodeProjectSkillsSpy: ReturnType<typeof spyOn>
let skillsToCommandDefinitionRecordSpy: ReturnType<typeof spyOn>

beforeEach(() => {
  loadBuiltinCommandsSpy = spyOn(builtinCommandsModule, "loadBuiltinCommands" as any).mockReturnValue({})
  loadUserCommandsSpy = spyOn(ccCommandLoaderModule, "loadUserCommands" as any).mockResolvedValue({})
  loadProjectCommandsSpy = spyOn(ccCommandLoaderModule, "loadProjectCommands" as any).mockResolvedValue({})
  loadOpencodeGlobalCommandsSpy = spyOn(ccCommandLoaderModule, "loadOpencodeGlobalCommands" as any).mockResolvedValue({})
  loadOpencodeProjectCommandsSpy = spyOn(ccCommandLoaderModule, "loadOpencodeProjectCommands" as any).mockResolvedValue({})
  discoverConfigSourceSkillsSpy = spyOn(opencodeSkillLoaderModule, "discoverConfigSourceSkills" as any).mockResolvedValue([])
  loadUserSkillsSpy = spyOn(opencodeSkillLoaderModule, "loadUserSkills" as any).mockResolvedValue({})
  loadProjectSkillsSpy = spyOn(opencodeSkillLoaderModule, "loadProjectSkills" as any).mockResolvedValue({})
  loadOpencodeGlobalSkillsSpy = spyOn(opencodeSkillLoaderModule, "loadOpencodeGlobalSkills" as any).mockResolvedValue({})
  loadOpencodeProjectSkillsSpy = spyOn(opencodeSkillLoaderModule, "loadOpencodeProjectSkills" as any).mockResolvedValue({})
  skillsToCommandDefinitionRecordSpy = spyOn(skillDefinitionRecordModule, "skillsToCommandDefinitionRecord" as any).mockReturnValue({})
})

afterEach(() => {
  loadBuiltinCommandsSpy.mockRestore()
  loadUserCommandsSpy.mockRestore()
  loadProjectCommandsSpy.mockRestore()
  loadOpencodeGlobalCommandsSpy.mockRestore()
  loadOpencodeProjectCommandsSpy.mockRestore()
  discoverConfigSourceSkillsSpy.mockRestore()
  loadUserSkillsSpy.mockRestore()
  loadProjectSkillsSpy.mockRestore()
  loadOpencodeGlobalSkillsSpy.mockRestore()
  loadOpencodeProjectSkillsSpy.mockRestore()
  skillsToCommandDefinitionRecordSpy.mockRestore()
})

const EMPTY_PLUGIN_COMPONENTS = {
  commands: {},
  skills: {},
  agents: {},
  mcpServers: {},
  hooksConfigs: [],
  plugins: [],
  errors: [],
}

function createPluginConfig(): MatrixxConfig {
  return {} as MatrixxConfig
}

describe("applyCommandConfig", () => {
  test("does NOT remap agent field from config key to display name (primary regression)", async () => {
    //#given
    const config: Record<string, unknown> = { command: {} }
    const pluginConfig = createPluginConfig()
    const pluginComponents = {
      ...EMPTY_PLUGIN_COMPONENTS,
      commands: {
        "start-work": {
          name: "start-work",
          description: "Start work session",
          agent: "architect",
          template: "template",
        },
      },
    }

    //#when
    const { applyCommandConfig } = await import("./command-config-handler")
    await applyCommandConfig({
      config,
      pluginConfig,
      ctx: { directory: "/tmp" },
      pluginComponents,
    })

    //#then
    const result = config.command as Record<string, Record<string, unknown>>
    // This FAILS on current source because remapCommandAgentFields
    // converts "architect" to "Architect (Plan Execution Orchestrator)"
    expect(result["start-work"].agent).toBe("architect")
  })

  test("preserves unknown agent name not in AGENT_DISPLAY_NAMES", async () => {
    //#given
    const config: Record<string, unknown> = { command: {} }
    const pluginConfig = createPluginConfig()
    const pluginComponents = {
      ...EMPTY_PLUGIN_COMPONENTS,
      commands: {
        "my-cmd": {
          name: "my-cmd",
          description: "Custom command",
          agent: "custom-agent",
          template: "template",
        },
      },
    }

    //#when
    const { applyCommandConfig } = await import("./command-config-handler")
    await applyCommandConfig({
      config,
      pluginConfig,
      ctx: { directory: "/tmp" },
      pluginComponents,
    })

    //#then
    const result = config.command as Record<string, Record<string, unknown>>
    expect(result["my-cmd"].agent).toBe("custom-agent")
  })

  test("handles command with no agent field", async () => {
    //#given
    const config: Record<string, unknown> = { command: {} }
    const pluginConfig = createPluginConfig()
    const pluginComponents = {
      ...EMPTY_PLUGIN_COMPONENTS,
      commands: {
        "no-agent-cmd": {
          name: "no-agent-cmd",
          description: "Command without agent",
          template: "template",
        },
      },
    }

    //#when
    const { applyCommandConfig } = await import("./command-config-handler")
    await applyCommandConfig({
      config,
      pluginConfig,
      ctx: { directory: "/tmp" },
      pluginComponents,
    })

    //#then
    const result = config.command as Record<string, Record<string, unknown>>
    expect(result["no-agent-cmd"]).not.toHaveProperty("agent")
  })

  test("handles empty string agent field", async () => {
    //#given
    const config: Record<string, unknown> = { command: {} }
    const pluginConfig = createPluginConfig()
    const pluginComponents = {
      ...EMPTY_PLUGIN_COMPONENTS,
      commands: {
        "empty-agent-cmd": {
          name: "empty-agent-cmd",
          description: "Command with empty agent",
          agent: "",
          template: "template",
        },
      },
    }

    //#when
    const { applyCommandConfig } = await import("./command-config-handler")
    await applyCommandConfig({
      config,
      pluginConfig,
      ctx: { directory: "/tmp" },
      pluginComponents,
    })

    //#then
    const result = config.command as Record<string, Record<string, unknown>>
    expect(result["empty-agent-cmd"].agent).toBe("")
  })

  test("does NOT remap agent field from skill sources", async () => {
    //#given
    const config: Record<string, unknown> = { command: {} }
    const pluginConfig = createPluginConfig()
    loadUserSkillsSpy.mockResolvedValue({
      "oracle-skill": {
        name: "oracle-skill",
        description: "Oracle analysis skill",
        agent: "oracle",
        template: "template",
      },
    })

    //#when
    const { applyCommandConfig } = await import("./command-config-handler")
    await applyCommandConfig({
      config,
      pluginConfig,
      ctx: { directory: "/tmp" },
      pluginComponents: EMPTY_PLUGIN_COMPONENTS,
    })

    //#then
    const result = config.command as Record<string, Record<string, unknown>>
    expect(result["oracle-skill"].agent).toBe("oracle")
  })
})
