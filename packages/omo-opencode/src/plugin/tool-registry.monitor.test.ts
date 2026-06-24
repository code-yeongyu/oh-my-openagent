import { describe, expect, mock, test } from "bun:test"
import { tool } from "@opencode-ai/plugin"

import { OhMyOpenCodeConfigSchema, type OhMyOpenCodeConfig } from "../config"
import type { MonitorManager } from "../features/monitor"
import { unsafeTestValue } from "../../../../test-support/unsafe-test-value"
import { createToolRegistry } from "./tool-registry"

const fakeTool = tool({
  description: "test tool",
  args: {},
  async execute(): Promise<string> {
    return "ok"
  },
})

const MONITOR_TOOL_NAMES = ["monitor_start", "monitor_stop", "monitor_list", "monitor_output"] as const

type PluginConfigOverrides = Omit<Partial<OhMyOpenCodeConfig>, "monitor"> & {
  monitor?: Partial<NonNullable<OhMyOpenCodeConfig["monitor"]>>
}

function createPluginConfig(overrides: PluginConfigOverrides = {}): OhMyOpenCodeConfig {
  return OhMyOpenCodeConfigSchema.parse({
    git_master: {
      commit_footer: false,
      include_co_authored_by: false,
      git_env_prefix: "",
    },
    ...overrides,
  })
}

function createMonitorManager(): MonitorManager {
  return unsafeTestValue<MonitorManager>({
    start: mock(async () => undefined),
    stop: mock(async () => undefined),
    list: mock(() => []),
    get: mock(() => undefined),
    getOutput: mock(() => ({ lines: [], counters: {} })),
    stopSessionMonitors: mock(async () => undefined),
    handleEvent: mock(() => undefined),
    shutdown: mock(async () => undefined),
  })
}

function createRegistry(pluginConfig: OhMyOpenCodeConfig) {
  return createToolRegistry({
    ctx: { directory: "/tmp/monitor", client: {} } as Parameters<typeof createToolRegistry>[0]["ctx"],
    pluginConfig,
    managers: unsafeTestValue<Parameters<typeof createToolRegistry>[0]["managers"]>({
      backgroundManager: {},
      tmuxSessionManager: {},
      skillMcpManager: {},
      modelFallbackControllerAccessor: {},
      monitorManager: createMonitorManager(),
    }),
    skillContext: {
      mergedSkills: [],
      availableSkills: [],
      browserProvider: "playwright",
      disabledSkills: new Set(),
    },
    availableCategories: [],
    interactiveBashEnabled: false,
    toolFactories: {
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
    },
  })
}

describe("monitor tool registry wiring", () => {
  test("#given monitor is disabled #when registry is created #then monitor tools are absent", () => {
    const result = createRegistry(createPluginConfig({ monitor: { enabled: false } }))

    for (const toolName of MONITOR_TOOL_NAMES) {
      expect(result.filteredTools).not.toHaveProperty(toolName)
    }
  })

  test("#given monitor is enabled #when registry is created #then all monitor tools are present with normalized schemas", () => {
    const result = createRegistry(createPluginConfig({ monitor: { enabled: true } }))

    for (const toolName of MONITOR_TOOL_NAMES) {
      expect(result.filteredTools).toHaveProperty(toolName)
      const toolDefinition = result.filteredTools[toolName]
      for (const schema of Object.values(toolDefinition.args)) {
        const toJSONSchema = schema._zod.toJSONSchema
        expect(typeof toJSONSchema).toBe("function")
        expect(toJSONSchema?.()).not.toHaveProperty("$schema")
      }
    }
  })

  test("#given monitor_start is disabled by name #when registry is created #then only monitor_start is removed", () => {
    const result = createRegistry(createPluginConfig({
      monitor: { enabled: true },
      disabled_tools: ["monitor_start"],
    }))

    expect(result.filteredTools).not.toHaveProperty("monitor_start")
    expect(result.filteredTools).toHaveProperty("monitor_stop")
    expect(result.filteredTools).toHaveProperty("monitor_list")
    expect(result.filteredTools).toHaveProperty("monitor_output")
  })
})
