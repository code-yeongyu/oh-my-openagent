import { describe, expect, mock, test } from "bun:test"
import { tool } from "@opencode-ai/plugin"
import type { DelegateTaskToolOptions } from "../tools/delegate-task/types"
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

function createFactories(args: {
  readonly createSkillTool: (options: SkillLoadOptions) => typeof fakeTool
  readonly createDelegateTask?: (options: DelegateTaskToolOptions) => typeof fakeTool
}): ToolRegistryFactories {
  return {
    createBackgroundTools: () => ({}),
    createCallOmoAgent: () => fakeTool,
    createLookAt: () => fakeTool,
    createSkillMcpTool: () => fakeTool,
    createSkillTool: args.createSkillTool,
    createGrepTools: () => ({}),
    createGlobTools: () => ({}),
    createSessionManagerTools: () => ({}),
    createDelegateTask: args.createDelegateTask ?? (() => fakeTool),
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
      factories: createFactories({ createSkillTool }),
    })

    // then
    expect(createSkillTool).toHaveBeenCalledTimes(1)
    expect(createSkillTool.mock.calls[0]?.[0].disabledSkills).toBe(disabledSkills)
  })

  test("#given current OpenCode exposes skills through the app skill endpoint #when core tools register the skill tool #then the skill tool can load native skills", async () => {
    // given
    const createSkillTool = mock((options: SkillLoadOptions) => fakeTool)
    const createDelegateTask = mock((options: DelegateTaskToolOptions) => fakeTool)
    const appSkills = mock(async () => ({
      data: [
        {
          name: "customize-opencode",
          description: "Built-in OpenCode config skill",
          location: "<built-in>",
          content: "Use OpenCode config schemas.",
        },
      ],
    }))

    // when
    createCoreTools({
      ctx: unsafeTestValue({
        directory: "/tmp/project",
        client: {
          app: {
            skills: appSkills,
          },
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
      factories: createFactories({ createSkillTool, createDelegateTask }),
    })

    // then
    const nativeSkills = createSkillTool.mock.calls[0]?.[0].nativeSkills
    const delegateNativeSkills = createDelegateTask.mock.calls[0]?.[0].nativeSkills
    expect(nativeSkills).toBeDefined()
    expect(delegateNativeSkills).toBe(nativeSkills)
    const loaded = await nativeSkills?.all()
    expect(appSkills).toHaveBeenCalledWith({ directory: "/tmp/project" })
    expect(loaded).toEqual([
      {
        name: "customize-opencode",
        description: "Built-in OpenCode config skill",
        location: "<built-in>",
        content: "Use OpenCode config schemas.",
      },
    ])
  })
})
