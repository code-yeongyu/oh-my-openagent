import { describe, expect, mock, spyOn, test } from "bun:test"
import * as validation from "../config/validate"
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
  test.each([
    { agents: false, expected: false },
    { agents: undefined, expected: true },
    { agents: true, expected: true },
  ])("#when claude_code.agents is $agents #then task receives the flag and shares the runtime skill resolver", ({ agents, expected }) => {
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
        claude_code: { agents },
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
    expect(createDelegateTask.mock.calls[0]?.[0].claudeCodeAgentsEnabled).toBe(expected)
    expect(createSkillMcpTool.mock.calls[0]?.[0].getLoadedSkills).toBe(skillResolver)
  })

  test("#when a cleanup delay is configured #then delegate task receives it", () => {
    const createDelegateTask = mock((options: Parameters<ToolRegistryFactories["createDelegateTask"]>[0]) => fakeTool)
    const factories = {
      ...createFactories(() => fakeTool),
      createDelegateTask,
    }

    createCoreTools({
      ctx: unsafeTestValue({ directory: "/tmp/project", client: {} }),
      pluginConfig: unsafeTestValue({
        disabled_agents: ["multimodal-looker"],
        background_task: { taskCleanupDelayMs: 120000 },
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

    expect(createDelegateTask.mock.calls[0]?.[0].taskCleanupDelayMs).toBe(120000)
  })
})

describe("runtime model config wiring", () => {
  test("the loader without session profiles accepts sanitized routing despite unrelated diagnostics", async () => {
    const validate = spyOn(validation, "validatePluginConfig").mockReturnValue({
      valid: false, messages: ["unrelated unknown setting"], warnings: ["ignored unrelated value"], path: null,
      config: { agents: { explore: { model: "fixture/updated" } } },
    })
    try {
      const createDelegateTask = mock((options: Parameters<ToolRegistryFactories["createDelegateTask"]>[0]) => fakeTool)
      const createCallOmoAgent = mock((...args: Parameters<ToolRegistryFactories["createCallOmoAgent"]>) => fakeTool)
      createCoreTools({
        ctx: unsafeTestValue({ directory: "/tmp/project", client: {} }),
        pluginConfig: { disabled_agents: ["multimodal-looker"], agents: { explore: { model: "fixture/startup" } } },
        managers: unsafeTestValue({ backgroundManager: {}, tmuxSessionManager: {}, skillMcpManager: {}, modelFallbackControllerAccessor: {} }),
        skillContext: { mergedSkills: [], availableSkills: [], browserProvider: "playwright", disabledSkills: new Set() },
        availableCategories: [],
        factories: { ...createFactories(() => fakeTool), createDelegateTask, createCallOmoAgent },
      })
      const loader = createDelegateTask.mock.calls[0]?.[0].loadCurrentModelConfig
      expect(loader).toBe(createCallOmoAgent.mock.calls[0]?.[6])
      expect((await loader?.("session"))?.agents?.explore?.model).toBe("fixture/updated")
    } finally {
      validate.mockRestore()
    }
  })

  test("task and call_omo_agent share one dispatch-time snapshot loader without changing startup registration", () => {
    const createDelegateTask = mock((options: Parameters<ToolRegistryFactories["createDelegateTask"]>[0]) => fakeTool)
    const createCallOmoAgent = mock((...args: Parameters<ToolRegistryFactories["createCallOmoAgent"]>) => fakeTool)
    const agents = { explore: { model: "fixture/startup" } }
    const categories = { runtime: { model: "fixture/startup" } }
    createCoreTools({
      ctx: unsafeTestValue({ directory: "/tmp/project", client: {} }),
      pluginConfig: { disabled_agents: ["multimodal-looker"], agents, categories },
      managers: unsafeTestValue({ backgroundManager: {}, tmuxSessionManager: {}, skillMcpManager: {}, modelFallbackControllerAccessor: {} }),
      skillContext: { mergedSkills: [], availableSkills: [], browserProvider: "playwright", disabledSkills: new Set() },
      availableCategories: [],
      factories: { ...createFactories(() => fakeTool), createDelegateTask, createCallOmoAgent },
    })
    const loader = createDelegateTask.mock.calls[0]?.[0].loadCurrentModelConfig
    expect(typeof loader).toBe("function")
    expect(createCallOmoAgent.mock.calls[0]?.[6]).toBe(loader)
    expect(createCallOmoAgent.mock.calls[0]?.[3]).toBe(agents)
    expect(createCallOmoAgent.mock.calls[0]?.[4]).toBe(categories)
    expect(createDelegateTask.mock.calls[0]?.[0].agentOverrides).toBe(agents)
    expect(createDelegateTask.mock.calls[0]?.[0].userCategories).toBe(categories)
  })
})
