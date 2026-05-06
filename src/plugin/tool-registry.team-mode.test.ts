/// <reference types="bun-types" />

import { describe, expect, mock, test } from "bun:test"

import { tool } from "@opencode-ai/plugin"

import { OhMyOpenCodeConfigSchema } from "../config"
import type { OpencodeClient } from "../tools/delegate-task/types"
import { createToolRegistry } from "./tool-registry"

const fakeTool = tool({
  description: "test tool",
  args: {},
  async execute(): Promise<string> {
    return "ok"
  },
})

function createPluginConfig() {
  return OhMyOpenCodeConfigSchema.parse({
    git_master: {
      commit_footer: false,
      include_co_authored_by: false,
      git_env_prefix: "",
    },
    team_mode: {
      enabled: true,
    },
  })
}

describe("team-mode tool registry wiring", () => {
  test("passes ctx.client into every team tool factory", () => {
    // given
    const client = {} as OpencodeClient
    const createTeamCreateTool = mock(() => fakeTool)
    const createTeamDeleteTool = mock(() => fakeTool)
    const createTeamShutdownRequestTool = mock(() => fakeTool)
    const createTeamApproveShutdownTool = mock(() => fakeTool)
    const createTeamRejectShutdownTool = mock(() => fakeTool)
    const createTeamSendMessageTool = mock(() => fakeTool)
    const createTeamTaskCreateTool = mock(() => fakeTool)
    const createTeamTaskListTool = mock(() => fakeTool)
    const createTeamTaskUpdateTool = mock(() => fakeTool)
    const createTeamTaskGetTool = mock(() => fakeTool)
    const createTeamStatusTool = mock(() => fakeTool)
    const createTeamListTool = mock(() => fakeTool)

    // when
    createToolRegistry({
      ctx: { directory: "/tmp/team-mode", client } as Parameters<typeof createToolRegistry>[0]["ctx"],
      pluginConfig: createPluginConfig(),
      managers: {
        backgroundManager: {},
        tmuxSessionManager: {},
        skillMcpManager: {},
      } as Parameters<typeof createToolRegistry>[0]["managers"],
      skillContext: {
        mergedSkills: [],
        availableSkills: [],
        browserProvider: "playwright",
        disabledSkills: new Set(),
      },
      availableCategories: [],
      toolFactories: {
        builtinTools: { bash: fakeTool, read: fakeTool },
        createBackgroundTools: mock(() => ({})),
        createCallOmoAgent: mock(() => fakeTool),
        createLookAt: mock(() => fakeTool),
        createSkillMcpTool: mock(() => fakeTool),
        createSkillTool: mock(() => fakeTool),
        createGrepTools: mock(() => ({})),
        createGlobTools: mock(() => ({})),
        createAstGrepTools: mock(() => ({})),
        createSessionManagerTools: mock(() => ({})),
        createDelegateTask: mock(() => fakeTool),
        discoverCommandsSync: mock(() => []),
        interactive_bash: fakeTool,
        createTaskCreateTool: mock(() => fakeTool),
        createTaskGetTool: mock(() => fakeTool),
        createTaskList: mock(() => fakeTool),
        createTaskUpdateTool: mock(() => fakeTool),
        createHashlineEditTool: mock(() => fakeTool),
        createTeamCreateTool,
        createTeamDeleteTool,
        createTeamShutdownRequestTool,
        createTeamApproveShutdownTool,
        createTeamRejectShutdownTool,
        createTeamSendMessageTool,
        createTeamTaskCreateTool,
        createTeamTaskListTool,
        createTeamTaskUpdateTool,
        createTeamTaskGetTool,
        createTeamStatusTool,
        createTeamListTool,
      },
    })

    // then
    expect(createTeamCreateTool).toHaveBeenCalledWith(expect.anything(), client, expect.anything(), expect.anything(), expect.anything())
    expect(createTeamDeleteTool).toHaveBeenCalledWith(expect.anything(), client, expect.anything(), expect.anything())
    expect(createTeamShutdownRequestTool).toHaveBeenCalledWith(expect.anything(), client)
    expect(createTeamApproveShutdownTool).toHaveBeenCalledWith(expect.anything(), client)
    expect(createTeamRejectShutdownTool).toHaveBeenCalledWith(expect.anything(), client)
    expect(createTeamSendMessageTool).toHaveBeenCalledWith(expect.anything(), client)
    expect(createTeamTaskCreateTool).toHaveBeenCalledWith(expect.anything(), client)
    expect(createTeamTaskListTool).toHaveBeenCalledWith(expect.anything(), client)
    expect(createTeamTaskUpdateTool).toHaveBeenCalledWith(expect.anything(), client)
    expect(createTeamTaskGetTool).toHaveBeenCalledWith(expect.anything(), client)
    expect(createTeamStatusTool).toHaveBeenCalledWith(expect.anything(), client, expect.anything())
    expect(createTeamListTool).toHaveBeenCalledWith(expect.anything(), client)
  })
})
