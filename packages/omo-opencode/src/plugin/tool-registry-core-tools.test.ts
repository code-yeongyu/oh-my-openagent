import { describe, expect, mock, test } from "bun:test"
import { tool } from "@opencode-ai/plugin"
import type { SkillLoadOptions } from "../tools/skill/types"
import type { ToolRegistryFactories } from "./tool-registry-factories"

import { unsafeTestValue } from "../../../../test-support/unsafe-test-value"
import { createCoreTools } from "./tool-registry-core-tools"

const fakeTool = tool({
  description: "fake tool",
  args: {},
  async execute(): Promise<string> {
    return "ok"
  },
})

function createFactories(createSkillTool: (options: SkillLoadOptions) => typeof fakeTool): ToolRegistryFactories {
  return {
    createBackgroundTools: () => ({}),
    createCallOmoAgent: () => fakeTool,
    createLookAt: () => fakeTool,
    createMonitorTools: () => ({}),
    createSkillMcpTool: () => fakeTool,
    createSkillTool,
    createGrepTools: () => ({}),
    createGlobTools: () => ({}),
    createSessionManagerTools: () => ({}),
    createDelegateTask: () => fakeTool,
    discoverCommandsSync: () => [],
    interactive_bash: fakeTool,
    createTaskCreateTool: () => fakeTool,
    createTaskGetTool: () => fakeTool,
    createTaskList: () => fakeTool,
    createTaskUpdateTool: () => fakeTool,
    createHashlineEditTool: () => fakeTool,
    createTeamApproveShutdownTool: () => fakeTool,
    createTeamCreateTool: () => fakeTool,
    createTeamDeleteTool: () => fakeTool,
    createTeamRejectShutdownTool: () => fakeTool,
    createTeamShutdownRequestTool: () => fakeTool,
    createTeamSendMessageTool: () => fakeTool,
    createTeamTaskCreateTool: () => fakeTool,
    createTeamTaskGetTool: () => fakeTool,
    createTeamTaskListTool: () => fakeTool,
    createTeamTaskUpdateTool: () => fakeTool,
    createTeamStatusTool: () => fakeTool,
    createTeamListTool: () => fakeTool,
  }
}

describe("#given disabled native skills in the registry skill context", () => {
  test("#when core tools register the skill tool #then disabled skills are passed to the skill tool factory", () => {
    // given
    const disabledSkills = new Set(["native-security-skill"])
    const createSkillTool = mock((options: SkillLoadOptions) => fakeTool)

    // when
    createCoreTools({
      ctx: unsafeTestValue({ directory: "/tmp/project" }),
      pluginConfig: unsafeTestValue({
        disabled_agents: ["multimodal-looker"],
      }),
      managers: unsafeTestValue({
        backgroundManager: {},
        tmuxSessionManager: {},
        skillMcpManager: {},
        modelFallbackControllerAccessor: {},
      }),
      skillContext: {
        mergedSkills: [],
        availableSkills: [],
        browserProvider: "playwright",
        disabledSkills,
      },
      availableCategories: [],
      factories: createFactories(createSkillTool),
    })

    // then
    expect(createSkillTool).toHaveBeenCalledTimes(1)
    expect(createSkillTool.mock.calls[0]?.[0].disabledSkills).toBe(disabledSkills)
  })
})

describe("#given core skill tools are registered", () => {
  test("#when core tools are created #then skill task and skill_mcp share the runtime skill resolver", () => {
    const createSkillTool = mock((options: SkillLoadOptions) => fakeTool)
    const createDelegateTask = mock((options: Parameters<ToolRegistryFactories["createDelegateTask"]>[0]) => fakeTool)
    const createSkillMcpTool = mock((options: Parameters<ToolRegistryFactories["createSkillMcpTool"]>[0]) => fakeTool)
    const factories = {
      ...createFactories(createSkillTool),
      createDelegateTask,
      createSkillMcpTool,
    }

    createCoreTools({
      ctx: unsafeTestValue({
        directory: "/tmp/project",
        client: {
          config: { get: async () => ({ data: {} }) },
        },
      }),
      pluginConfig: unsafeTestValue({
        disabled_agents: ["multimodal-looker"],
      }),
      managers: unsafeTestValue({
        backgroundManager: {},
        tmuxSessionManager: {},
        skillMcpManager: {},
        modelFallbackControllerAccessor: {},
      }),
      skillContext: {
        mergedSkills: [],
        availableSkills: [],
        browserProvider: "playwright",
        disabledSkills: new Set(),
      },
      availableCategories: [],
      factories,
    })

    const skillResolver = createSkillTool.mock.calls[0]?.[0].getLoadedSkills

    expect(typeof skillResolver).toBe("function")
    expect(createDelegateTask.mock.calls[0]?.[0].getLoadedSkills).toBe(skillResolver)
    expect(createSkillMcpTool.mock.calls[0]?.[0].getLoadedSkills).toBe(skillResolver)
  })
})
