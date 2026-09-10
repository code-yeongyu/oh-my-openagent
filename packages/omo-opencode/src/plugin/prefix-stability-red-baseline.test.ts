const { describe, expect, mock, test } = require("bun:test")
import { tool } from "@opencode-ai/plugin"

import { OhMyOpenCodeConfigSchema } from "../config"

const fakeTool = tool({
  description: "test tool",
  args: {},
  async execute(): Promise<string> {
    return "ok"
  },
})

const { createToolRegistry } = await import("./tool-registry")

const toolFactories: NonNullable<Parameters<typeof createToolRegistry>[0]["toolFactories"]> = {
  createBackgroundTools: mock(() => ({})),
  createCallOmoAgent: mock(() => fakeTool),
  createLookAt: mock(() => fakeTool),
  createSkillMcpTool: mock(() => fakeTool),
  createSkillTool: mock(() => fakeTool),
  createGrepTools: mock(() => ({})),
  createGlobTools: mock(() => ({})),
  createSessionManagerTools: mock(() => ({})),
  createDelegateTask: mock(() => fakeTool),
  discoverCommandsSync: mock(() => []),
  interactive_bash: fakeTool,
  createTaskCreateTool: mock(() => fakeTool),
  createTaskGetTool: mock(() => fakeTool),
  createTaskList: mock(() => fakeTool),
  createTaskUpdateTool: mock(() => fakeTool),
  createHashlineEditTool: mock(() => fakeTool),
  createTeamApproveShutdownTool: mock(() => fakeTool),
  createTeamCreateTool: mock(() => fakeTool),
  createTeamDeleteTool: mock(() => fakeTool),
  createTeamRejectShutdownTool: mock(() => fakeTool),
  createTeamShutdownRequestTool: mock(() => fakeTool),
  createTeamSendMessageTool: mock(() => fakeTool),
  createTeamTaskCreateTool: mock(() => fakeTool),
  createTeamTaskGetTool: mock(() => fakeTool),
  createTeamTaskListTool: mock(() => fakeTool),
  createTeamTaskUpdateTool: mock(() => fakeTool),
  createTeamStatusTool: mock(() => fakeTool),
  createTeamListTool: mock(() => fakeTool),
}

function baseArgs(interactiveBashEnabled: boolean): Parameters<typeof createToolRegistry>[0] {
  return {
    ctx: { directory: "/tmp" } as Parameters<typeof createToolRegistry>[0]["ctx"],
    pluginConfig: OhMyOpenCodeConfigSchema.parse({
      git_master: {
        commit_footer: false,
        include_co_authored_by: false,
        git_env_prefix: "",
      },
    }),
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
    interactiveBashEnabled,
    toolFactories,
  }
}

describe("#given tool registry export order", () => {
  test("#when registry exports tool keys #then keys are sorted alphabetically for byte-stable prefix", () => {
    //#given
    const result = createToolRegistry(baseArgs(false))

    //#when
    const keys = Object.keys(result.filteredTools)

    //#then
    expect(keys).toEqual([...keys].sort())
  })

  test("#when registry builds twice with a flipped conditional gate #then both exports are byte-identical", () => {
    //#given
    const first = createToolRegistry(baseArgs(false))

    //#when
    const second = createToolRegistry(baseArgs(true))

    //#then
    expect(JSON.stringify(Object.keys(second.filteredTools))).toBe(
      JSON.stringify(Object.keys(first.filteredTools)),
    )
  })
})
