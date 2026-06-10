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

type RegistryArgs = Parameters<typeof createToolRegistry>[0]
type ToolFactories = NonNullable<RegistryArgs["toolFactories"]>

function createToolFactories(): ToolFactories {
  return {
    createBackgroundTools: mock(() => ({
      background_cancel: fakeTool,
      background_output: fakeTool,
    })),
    createCallOmoAgent: mock(() => fakeTool),
    createLookAt: mock(() => fakeTool),
    createSkillMcpTool: mock(() => fakeTool),
    createSkillTool: mock(() => fakeTool),
    createGrepTools: mock(() => ({ grep: fakeTool })),
    createGlobTools: mock(() => ({ glob: fakeTool })),
    createSessionManagerTools: mock(() => ({
      session_info: fakeTool,
      session_list: fakeTool,
      session_read: fakeTool,
      session_search: fakeTool,
    })),
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
}

function createRegistry(overrides: {
  readonly pluginConfig?: Record<string, unknown>
  readonly interactiveBashEnabled?: boolean
} = {}) {
  return createToolRegistry({
    ctx: {
      directory: "/tmp/tool-registry-characterization",
      client: {},
    } as RegistryArgs["ctx"],
    pluginConfig: OhMyOpenCodeConfigSchema.parse({
      git_master: {
        commit_footer: false,
        include_co_authored_by: false,
        git_env_prefix: "",
      },
      ...overrides.pluginConfig,
    }),
    managers: {
      backgroundManager: {},
      tmuxSessionManager: {},
      skillMcpManager: {},
    } as RegistryArgs["managers"],
    skillContext: {
      mergedSkills: [],
      availableSkills: [],
      browserProvider: "playwright",
      disabledSkills: new Set(),
    },
    availableCategories: [],
    interactiveBashEnabled: overrides.interactiveBashEnabled ?? false,
    toolFactories: createToolFactories(),
  })
}

describe("#given the default tool registry", () => {
  test("#when optional gates are omitted #then it registers the stable base tool set", () => {
    const result = createRegistry()

    expect(Object.keys(result.filteredTools)).toEqual([
      "grep",
      "glob",
      "session_info",
      "session_list",
      "session_read",
      "session_search",
      "background_cancel",
      "background_output",
      "call_omo_agent",
      "look_at",
      "task",
      "skill_mcp",
      "skill",
    ])
  })

  test("#when optional gates are enabled #then it adds only the gated tool names", () => {
    const result = createRegistry({
      interactiveBashEnabled: true,
      pluginConfig: {
        experimental: { task_system: true },
        hashline_edit: true,
        team_mode: { enabled: true },
      },
    })

    expect(Object.keys(result.filteredTools)).toEqual([
      "grep",
      "glob",
      "session_info",
      "session_list",
      "session_read",
      "session_search",
      "background_cancel",
      "background_output",
      "call_omo_agent",
      "look_at",
      "task",
      "skill_mcp",
      "skill",
      "interactive_bash",
      "team_create",
      "team_delete",
      "team_shutdown_request",
      "team_approve_shutdown",
      "team_reject_shutdown",
      "team_send_message",
      "team_task_create",
      "team_task_list",
      "team_task_update",
      "team_task_get",
      "team_status",
      "team_list",
      "task_create",
      "task_get",
      "task_list",
      "task_update",
      "edit",
    ])
  })
})
