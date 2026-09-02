import { expect, mock, test } from "bun:test"
import { tool } from "@opencode-ai/plugin"
import type { BackgroundManager } from "../features/background-agent"
import { createCallOmoAgent } from "../tools"
import { unsafeTestValue } from "../../../../test-support/unsafe-test-value"
import { createCoreTools } from "./tool-registry-core-tools"
import { defaultToolRegistryFactories } from "./tool-registry-factories"

const fakeTool = tool({
  description: "fake tool",
  args: {},
  async execute(): Promise<string> {
    return "ok"
  },
})

test("#given a disabled provider mirror #when call_omo_agent launches through the core registry #then it selects the next allowed fallback", async () => {
  // given
  const launch = mock((_input: Parameters<BackgroundManager["launch"]>[0]) => Promise.resolve(unsafeTestValue({
    id: "task-disabled-provider",
    sessionId: "sub-session",
    description: "Inspect models",
    agent: "explore",
    status: "pending",
  })))
  const factories = {
    ...defaultToolRegistryFactories,
    createBackgroundTools: () => ({}),
    createCallOmoAgent,
    createDelegateTask: () => fakeTool,
    createGlobTools: () => ({}),
    createGrepTools: () => ({}),
    createSessionManagerTools: () => ({}),
    createSkillMcpTool: () => fakeTool,
    createSkillTool: () => fakeTool,
    discoverCommandsSync: () => [],
  }
  const tools = createCoreTools({
    ctx: unsafeTestValue({
      directory: "/tmp/project",
      client: {
        app: {
          agents: async () => ({
            data: [
              { name: "explore", mode: "subagent" },
              { name: "librarian", mode: "subagent" },
            ],
          }),
        },
      },
    }),
    pluginConfig: unsafeTestValue({
      disabled_agents: ["multimodal-looker"],
      disabled_providers: ["openai-codex"],
    }),
    managers: unsafeTestValue({
      backgroundManager: {
        launch,
      },
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

  // when
  await tools.call_omo_agent?.execute(
    unsafeTestValue({
      description: "Inspect models",
      prompt: "Inspect the model registry",
      subagent_type: "explore",
      run_in_background: true,
    }),
    unsafeTestValue({
      sessionID: "parent-session",
      messageID: "parent-message",
      agent: "sisyphus",
      abort: new AbortController().signal,
    }),
  )

  // then
  const launchInput = launch.mock.calls[0]?.[0]
  expect(launchInput?.model).toEqual({
    providerID: "deepseek",
    modelID: "deepseek-v4-flash",
    variant: "max",
  })
})
