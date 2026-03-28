import type { AgentConfig } from "@opencode-ai/sdk"
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import * as agents from "../agents"
import * as shared from "../shared"
import * as sisyphusJunior from "../agents/sisyphus-junior"
import type { OhMyOpenCodeConfig } from "../config"
import * as skillLoader from "../features/opencode-skill-loader"
import { applyAgentConfig } from "./agent-config-handler"
import type { PluginComponents } from "./plugin-components-loader"

function createPluginComponents(): PluginComponents {
  return {
    commands: {},
    skills: {},
    agents: {},
    mcpServers: {},
    hooksConfigs: [],
    plugins: [],
    errors: [],
  }
}

function createPluginConfig(): OhMyOpenCodeConfig {
  return {
    sisyphus_agent: {
      planner_enabled: false,
    },
  }
}

describe("applyAgentConfig .agents skills", () => {
  let createBuiltinAgentsSpy: ReturnType<typeof spyOn>
  let createSisyphusJuniorAgentSpy: ReturnType<typeof spyOn>
  let discoverConfigSourceSkillsSpy: ReturnType<typeof spyOn>
  let discoverUserClaudeSkillsSpy: ReturnType<typeof spyOn>
  let discoverProjectClaudeSkillsSpy: ReturnType<typeof spyOn>
  let discoverOpencodeGlobalSkillsSpy: ReturnType<typeof spyOn>
  let discoverOpencodeProjectSkillsSpy: ReturnType<typeof spyOn>
  let discoverProjectAgentsSkillsSpy: ReturnType<typeof spyOn>
  let discoverGlobalAgentsSkillsSpy: ReturnType<typeof spyOn>
  let logSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    createBuiltinAgentsSpy = spyOn(agents, "createBuiltinAgents").mockResolvedValue({
      sisyphus: { name: "sisyphus", prompt: "builtin", mode: "primary" } satisfies AgentConfig,
    })
    createSisyphusJuniorAgentSpy = spyOn(
      sisyphusJunior,
      "createSisyphusJuniorAgentWithOverrides",
    ).mockReturnValue({
      name: "sisyphus-junior",
      prompt: "junior",
      mode: "all",
    } satisfies AgentConfig)
    discoverConfigSourceSkillsSpy = spyOn(skillLoader, "discoverConfigSourceSkills").mockResolvedValue([])
    discoverUserClaudeSkillsSpy = spyOn(skillLoader, "discoverUserClaudeSkills").mockResolvedValue([])
    discoverProjectClaudeSkillsSpy = spyOn(skillLoader, "discoverProjectClaudeSkills").mockResolvedValue([])
    discoverOpencodeGlobalSkillsSpy = spyOn(skillLoader, "discoverOpencodeGlobalSkills").mockResolvedValue([])
    discoverOpencodeProjectSkillsSpy = spyOn(skillLoader, "discoverOpencodeProjectSkills").mockResolvedValue([])
    discoverProjectAgentsSkillsSpy = spyOn(skillLoader, "discoverProjectAgentsSkills").mockResolvedValue([])
    discoverGlobalAgentsSkillsSpy = spyOn(skillLoader, "discoverGlobalAgentsSkills").mockResolvedValue([])
    logSpy = spyOn(shared, "log").mockImplementation(() => {})
  })

  afterEach(() => {
    createBuiltinAgentsSpy.mockRestore()
    createSisyphusJuniorAgentSpy.mockRestore()
    discoverConfigSourceSkillsSpy.mockRestore()
    discoverUserClaudeSkillsSpy.mockRestore()
    discoverProjectClaudeSkillsSpy.mockRestore()
    discoverOpencodeGlobalSkillsSpy.mockRestore()
    discoverOpencodeProjectSkillsSpy.mockRestore()
    discoverProjectAgentsSkillsSpy.mockRestore()
    discoverGlobalAgentsSkillsSpy.mockRestore()
    logSpy.mockRestore()
  })

  test("calls .agents skill discovery during agent configuration", async () => {
    // given
    const directory = "/tmp/project"

    // when
    await applyAgentConfig({
      config: { model: "anthropic/claude-opus-4-6", agent: {} },
      pluginConfig: createPluginConfig(),
      ctx: { directory },
      pluginComponents: createPluginComponents(),
    })

    // then
    expect(discoverProjectAgentsSkillsSpy).toHaveBeenCalledWith(directory)
    expect(discoverGlobalAgentsSkillsSpy).toHaveBeenCalled()
  })

  test("passes discovered .agents skills to builtin agent creation", async () => {
    // given
    discoverProjectAgentsSkillsSpy.mockResolvedValue([
      {
        name: "project-agent-skill",
        definition: { name: "project-agent-skill", template: "project-template" },
        scope: "project",
      },
    ])
    discoverGlobalAgentsSkillsSpy.mockResolvedValue([
      {
        name: "global-agent-skill",
        definition: { name: "global-agent-skill", template: "global-template" },
        scope: "user",
      },
    ])

    // when
    await applyAgentConfig({
      config: { model: "anthropic/claude-opus-4-6", agent: {} },
      pluginConfig: createPluginConfig(),
      ctx: { directory: "/tmp/project" },
      pluginComponents: createPluginComponents(),
    })

    // then
    const discoveredSkills = createBuiltinAgentsSpy.mock.calls[0]?.[6] as Array<{ name: string }>
    expect(discoveredSkills.map(skill => skill.name)).toContain("project-agent-skill")
    expect(discoveredSkills.map(skill => skill.name)).toContain("global-agent-skill")
  })
})
