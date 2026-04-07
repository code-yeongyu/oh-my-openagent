import { describe, expect, mock, spyOn, test } from "bun:test"
import { tool } from "@opencode-ai/plugin"

import type { OhMyOpenCodeConfig } from "../config"
import * as openclawRuntimeDispatch from "../openclaw/runtime-dispatch"
import type { ToolsRecord } from "./types"

const fakeTool = tool({
  description: "test tool",
  args: {},
  async execute(): Promise<string> {
    return "ok"
  },
})

const delegateTaskTool = tool({
  description: "task tool",
  args: {},
  async execute(): Promise<string> {
    return "ok"
  },
})

const syncSessionCreatedCallbacks: Array<
  ((event: { sessionID: string; parentID: string; title: string }) => Promise<void>) | undefined
> = []

mock.module("../tools", () => ({
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
  createDelegateTask: mock((options: { onSyncSessionCreated?: typeof syncSessionCreatedCallbacks[number] }) => {
    syncSessionCreatedCallbacks.push(options.onSyncSessionCreated)
    return delegateTaskTool
  }),
  discoverCommandsSync: mock(() => []),
  interactive_bash: fakeTool,
  createTaskCreateTool: mock(() => fakeTool),
  createTaskGetTool: mock(() => fakeTool),
  createTaskList: mock(() => fakeTool),
  createTaskUpdateTool: mock(() => fakeTool),
  createHashlineEditTool: mock(() => fakeTool),
}))

const trackedPaneBySession = new Map<string, string>()

const { createToolRegistry, trimToolsToCap } = await import("./tool-registry")
const dispatchOpenClawEvent = spyOn(openclawRuntimeDispatch, "dispatchOpenClawEvent")

function createPluginConfig(overrides: Partial<OhMyOpenCodeConfig> = {}): OhMyOpenCodeConfig {
  return {
    git_master: {
      commit_footer: false,
      include_co_authored_by: false,
      git_env_prefix: "",
    },
    ...overrides,
  }
}

describe("#given tool trimming prioritization", () => {
  test("#when max_tools trims a hashline edit registration named edit #then edit is removed before higher-priority tools", () => {
    const filteredTools = {
      bash: fakeTool,
      edit: fakeTool,
      read: fakeTool,
    } satisfies ToolsRecord

    trimToolsToCap(filteredTools, 2)

    expect(filteredTools).not.toHaveProperty("edit")
    expect(filteredTools).toHaveProperty("bash")
    expect(filteredTools).toHaveProperty("read")
  })
})

describe("#given task_system configuration", () => {
  test("#when task_system is omitted #then task tools are not registered by default", () => {
    syncSessionCreatedCallbacks.length = 0

    const result = createToolRegistry({
      ctx: { directory: "/tmp" } as Parameters<typeof createToolRegistry>[0]["ctx"],
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
    })

    expect(result.taskSystemEnabled).toBe(false)
    expect(result.filteredTools).not.toHaveProperty("task_create")
    expect(result.filteredTools).not.toHaveProperty("task_get")
    expect(result.filteredTools).not.toHaveProperty("task_list")
    expect(result.filteredTools).not.toHaveProperty("task_update")
  })

  test("#when task_system is enabled #then task tools are registered", () => {
    syncSessionCreatedCallbacks.length = 0

    const result = createToolRegistry({
      ctx: { directory: "/tmp" } as Parameters<typeof createToolRegistry>[0]["ctx"],
      pluginConfig: createPluginConfig({
        experimental: { task_system: true },
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
    })

    expect(result.taskSystemEnabled).toBe(true)
    expect(result.filteredTools).toHaveProperty("task_create")
    expect(result.filteredTools).toHaveProperty("task_get")
    expect(result.filteredTools).toHaveProperty("task_list")
    expect(result.filteredTools).toHaveProperty("task_update")
  })
})

describe("#given tmux integration is disabled", () => {
  test("#when system tmux is available #then interactive_bash remains registered", () => {
    syncSessionCreatedCallbacks.length = 0

    const result = createToolRegistry({
      ctx: { directory: "/tmp" } as Parameters<typeof createToolRegistry>[0]["ctx"],
      pluginConfig: createPluginConfig({
        tmux: {
          enabled: false,
          layout: "main-vertical",
          main_pane_size: 60,
          main_pane_min_width: 120,
          agent_pane_min_width: 40,
          isolation: "inline",
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
      interactiveBashEnabled: true,
    })

    expect(result.filteredTools).toHaveProperty("interactive_bash")
  })

  test("#when system tmux is unavailable #then interactive_bash is not registered", () => {
    syncSessionCreatedCallbacks.length = 0

    const result = createToolRegistry({
      ctx: { directory: "/tmp" } as Parameters<typeof createToolRegistry>[0]["ctx"],
      pluginConfig: createPluginConfig({
        tmux: {
          enabled: false,
          layout: "main-vertical",
          main_pane_size: 60,
          main_pane_min_width: 120,
          agent_pane_min_width: 40,
          isolation: "inline",
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
      interactiveBashEnabled: false,
    })

    expect(result.filteredTools).not.toHaveProperty("interactive_bash")
  })
})

describe("#given openclaw is enabled for sync task sessions", () => {
  test("#when the sync session-created callback runs #then it dispatches openclaw with the tracked pane id", async () => {
    syncSessionCreatedCallbacks.length = 0
    dispatchOpenClawEvent.mockReset()
    trackedPaneBySession.clear()

    const tmuxSessionManager = {
      async onSessionCreated(event: { properties?: { info?: { id?: string } } }): Promise<void> {
        const sessionID = event.properties?.info?.id
        if (sessionID) {
          trackedPaneBySession.set(sessionID, `%pane-${sessionID}`)
        }
      },
      getTrackedPaneId(sessionID: string): string | undefined {
        return trackedPaneBySession.get(sessionID)
      },
    }

    const openclawConfig = {
      enabled: true,
      gateways: {},
      hooks: {},
    }

    createToolRegistry({
      ctx: { directory: "/tmp/project" } as Parameters<typeof createToolRegistry>[0]["ctx"],
      pluginConfig: createPluginConfig({ openclaw: openclawConfig }),
      managers: {
        backgroundManager: {},
        tmuxSessionManager,
        skillMcpManager: {},
      } as Parameters<typeof createToolRegistry>[0]["managers"],
      skillContext: {
        mergedSkills: [],
        availableSkills: [],
        browserProvider: "playwright",
        disabledSkills: new Set(),
      },
      availableCategories: [],
    })

    const onSyncSessionCreated = syncSessionCreatedCallbacks[syncSessionCreatedCallbacks.length - 1]
    await onSyncSessionCreated?.({
      sessionID: "ses-sync-1",
      parentID: "ses-parent",
      title: "sync task",
    })

    expect(dispatchOpenClawEvent).toHaveBeenCalledTimes(1)
    expect(dispatchOpenClawEvent).toHaveBeenCalledWith({
      config: openclawConfig,
      rawEvent: "session.created",
      context: {
        sessionId: "ses-sync-1",
        projectPath: "/tmp/project",
        tmuxPaneId: "%pane-ses-sync-1",
      },
    })
  })
})
