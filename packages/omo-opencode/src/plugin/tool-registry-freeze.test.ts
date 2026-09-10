const { beforeEach, describe, expect, mock, test } = require("bun:test")
import { tool } from "@opencode-ai/plugin"

import { OhMyOpenCodeConfigSchema, type OhMyOpenCodeConfig } from "../config"
import { stableStringify } from "../shared/stable-stringify"

const { clearToolRegistryCache, createToolRegistry } = await import("./tool-registry")

const fakeTool = tool({
  description: "test tool",
  args: {},
  async execute(): Promise<string> {
    return "ok"
  },
})

const toolFactories: NonNullable<Parameters<typeof createToolRegistry>[0]["toolFactories"]> = {
  createBackgroundTools: mock(() => ({})),
  createCallOmoAgent: mock(() => fakeTool),
  createLookAt: mock(() => fakeTool),
  createMonitorTools: mock(() => ({})),
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

function createPluginConfig(overrides: Record<string, unknown> = {}): OhMyOpenCodeConfig {
  return OhMyOpenCodeConfigSchema.parse({
    git_master: {
      commit_footer: false,
      include_co_authored_by: false,
      git_env_prefix: "",
    },
    ...overrides,
  })
}

function buildRegistryArgs(pluginConfig: OhMyOpenCodeConfig, sessionID: string) {
  return {
    ctx: { directory: "/tmp" } as Parameters<typeof createToolRegistry>[0]["ctx"],
    pluginConfig,
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
    } as unknown as Parameters<typeof createToolRegistry>[0]["skillContext"],
    availableCategories: [],
    toolFactories,
    sessionID,
  } as Parameters<typeof createToolRegistry>[0]
}

beforeEach(() => {
  clearToolRegistryCache()
})

describe("#given a frozen session registry", () => {
  test("#when exporting twice within a session #then both exports are byte-identical", () => {
    // given
    const args = buildRegistryArgs(createPluginConfig({ team_mode: { enabled: true } }), "ses-freeze-1")

    // when
    const first = createToolRegistry(args)
    const second = createToolRegistry(buildRegistryArgs(createPluginConfig({ team_mode: { enabled: true } }), "ses-freeze-1"))

    // then
    expect(second.filteredTools).toBe(first.filteredTools)
    expect(stableStringify(Object.keys(second.filteredTools))).toBe(stableStringify(Object.keys(first.filteredTools)))
  })

  test("#when a gate flips mid-session #then a new frozen generation is created", () => {
    // given
    const offConfig = createPluginConfig({ team_mode: { enabled: false } })
    const onConfig = createPluginConfig({ team_mode: { enabled: true } })

    // when
    const before = createToolRegistry(buildRegistryArgs(offConfig, "ses-gate-1"))
    const after = createToolRegistry(buildRegistryArgs(onConfig, "ses-gate-1"))

    // then
    expect(after.filteredTools).not.toBe(before.filteredTools)
    expect(Object.keys(after.filteredTools)).toContain("team_create")
    expect(Object.keys(before.filteredTools)).not.toContain("team_create")
  })

  test("#when tools assemble in gate-dependent insertion order #then export keys are sorted", () => {
    // given
    const args = buildRegistryArgs(
      createPluginConfig({ team_mode: { enabled: true }, experimental: { task_system: true } }),
      "ses-sort-1",
    )

    // when
    const result = createToolRegistry(args)

    // then
    const keys = Object.keys(result.filteredTools)
    expect(keys.length).toBeGreaterThan(1)
    expect(keys).toEqual([...keys].sort())
  })
})
