const { beforeEach, describe, expect, mock, spyOn, test } = require("bun:test")
import { tool } from "@opencode-ai/plugin"

import { OhMyOpenCodeConfigSchema, type OhMyOpenCodeConfig } from "../config"
import * as openclawRuntimeDispatch from "../openclaw/runtime-dispatch"
import type { DelegateTaskToolOptions } from "../tools/delegate-task/types"
import type { SkillLoadOptions } from "../tools/skill/types"
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

const trackedPaneBySession = new Map<string, string>()
let dispatchOpenClawEvent: ReturnType<typeof spyOn>

const TEAM_TOOL_NAMES = [
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
] as const

const { createToolRegistry, trimToolsToCap } = await import("./tool-registry")

const toolFactories: NonNullable<Parameters<typeof createToolRegistry>[0]["toolFactories"]> = {
  createBackgroundTools: mock(() => ({})),
  createCallOmoAgent: mock(() => fakeTool),
  createLookAt: mock(() => fakeTool),
  createSkillMcpTool: mock(() => fakeTool),
  createSkillTool: mock(() => fakeTool),
  createGrepTools: mock(() => ({})),
  createGlobTools: mock(() => ({})),
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

type PluginConfigOverrides = Omit<Partial<OhMyOpenCodeConfig>, "team_mode"> & {
  team_mode?: Partial<NonNullable<OhMyOpenCodeConfig["team_mode"]>>
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

beforeEach(() => {
  dispatchOpenClawEvent = spyOn(openclawRuntimeDispatch, "dispatchOpenClawEvent")
  syncSessionCreatedCallbacks.length = 0
})

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
      toolFactories,
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
      toolFactories,
    })

    expect(result.taskSystemEnabled).toBe(true)
    expect(result.filteredTools).toHaveProperty("task_create")
    expect(result.filteredTools).toHaveProperty("task_get")
    expect(result.filteredTools).toHaveProperty("task_list")
    expect(result.filteredTools).toHaveProperty("task_update")
  })
})

describe("#given the OMO skill tool overrides OpenCode native skill discovery", () => {
  test("#when the registry creates the skill tool #then plugin skills are advertised in the description", () => {
    const createSkillToolCallsBefore = toolFactories.createSkillTool.mock.calls.length

    createToolRegistry({
      ctx: { directory: "/tmp" } as Parameters<typeof createToolRegistry>[0]["ctx"],
      pluginConfig: createPluginConfig(),
      managers: {
        backgroundManager: {},
        tmuxSessionManager: {},
        skillMcpManager: {},
      } as Parameters<typeof createToolRegistry>[0]["managers"],
      skillContext: {
        mergedSkills: [
          {
            name: "security-review",
            path: "<builtin>/security-review/SKILL.md",
            definition: {
              name: "security-review",
              description: "Security review instructions",
              template: "review",
            },
            scope: "builtin",
          },
        ],
        availableSkills: [],
        browserProvider: "playwright",
        disabledSkills: new Set(),
      },
      availableCategories: [],
      toolFactories,
    })

    const skillToolOptions = toolFactories.createSkillTool.mock.calls[createSkillToolCallsBefore]?.[0]

    expect(skillToolOptions).toMatchObject({
      includeSkillsInDescription: true,
      skills: [
        {
          name: "security-review",
          definition: {
            name: "security-review",
          },
        },
      ],
    })
  })

  test("#when PluginInput lacks skills but raw client can list skills #then skill and task tools share a native skill accessor", async () => {
    const capturedSkillToolOptions: SkillLoadOptions[] = []
    const capturedDelegateTaskOptions: DelegateTaskToolOptions[] = []
    const nativeSkillEntries = [
      {
        name: "customize-opencode",
        description: "Customize OpenCode configuration",
        location: "<built-in>",
        content: "# Customizing opencode",
      },
      {
        name: "disabled-native",
        description: "Disabled native skill",
        location: "<built-in>",
        content: "# Disabled",
      },
    ]
    let resolveNativeSkills: (value: { data: typeof nativeSkillEntries }) => void = () => {}
    const nativeSkillsPromise = new Promise<{ data: typeof nativeSkillEntries }>((resolve) => {
      resolveNativeSkills = resolve
    })
    const rawGet = mock((input: { url: string; query: { directory: string } }) => {
      expect(input).toEqual({ url: "/skill", query: { directory: "/tmp/project" } })
      return nativeSkillsPromise
    })
    const localToolFactories = {
      ...toolFactories,
      createSkillTool: mock((options: SkillLoadOptions) => {
        capturedSkillToolOptions.push(options)
        return fakeTool
      }),
      createDelegateTask: mock((options: DelegateTaskToolOptions) => {
        capturedDelegateTaskOptions.push(options)
        return delegateTaskTool
      }),
    }

    createToolRegistry({
      ctx: {
        directory: "/tmp/project",
        client: {
          app: {},
          _client: {
            get: rawGet,
          },
        },
      } as unknown as Parameters<typeof createToolRegistry>[0]["ctx"],
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
        disabledSkills: new Set(["disabled-native"]),
      },
      availableCategories: [],
      toolFactories: localToolFactories,
    })

    const skillToolOptions = capturedSkillToolOptions[0]
    const delegateTaskOptions = capturedDelegateTaskOptions[0]
    const nativeSkills = skillToolOptions?.nativeSkills

    expect(nativeSkills).toBeDefined()
    expect(delegateTaskOptions?.nativeSkills).toBe(nativeSkills)

    resolveNativeSkills({ data: nativeSkillEntries })
    await expect(nativeSkills?.all()).resolves.toEqual([nativeSkillEntries[0]])
    await expect(nativeSkills?.get("customize-opencode")).resolves.toEqual(nativeSkillEntries[0])
    await expect(nativeSkills?.get("disabled-native")).resolves.toBeUndefined()
    expect(await nativeSkills?.dirs()).toEqual([])
  })

  test("#when raw client returns a direct array #then skills are normalized", async () => {
    const capturedSkillToolOptions: SkillLoadOptions[] = []
    const nativeSkillEntries = [{ name: "direct-skill", description: "Direct", location: "<built-in>", content: "# Direct" }]
    const rawGet = mock(async () => nativeSkillEntries)
    const localToolFactories = {
      ...toolFactories,
      createSkillTool: mock((options: SkillLoadOptions) => {
        capturedSkillToolOptions.push(options)
        return fakeTool
      }),
    }

    createToolRegistry({
      ctx: {
        directory: "/tmp/project",
        client: { app: {}, _client: { get: rawGet } },
      } as unknown as Parameters<typeof createToolRegistry>[0]["ctx"],
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
      toolFactories: localToolFactories,
    })

    const nativeSkills = capturedSkillToolOptions[0]?.nativeSkills
    await expect(nativeSkills?.all()).resolves.toEqual(nativeSkillEntries)
  })

  test("#when raw client returns an empty object #then skills list is empty", async () => {
    const capturedSkillToolOptions: SkillLoadOptions[] = []
    const rawGet = mock(async () => ({ data: null }))
    const localToolFactories = {
      ...toolFactories,
      createSkillTool: mock((options: SkillLoadOptions) => {
        capturedSkillToolOptions.push(options)
        return fakeTool
      }),
    }

    createToolRegistry({
      ctx: {
        directory: "/tmp/project",
        client: { app: {}, _client: { get: rawGet } },
      } as unknown as Parameters<typeof createToolRegistry>[0]["ctx"],
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
      toolFactories: localToolFactories,
    })

    const nativeSkills = capturedSkillToolOptions[0]?.nativeSkills
    await expect(nativeSkills?.all()).resolves.toEqual([])
  })

  test("#when raw file is absent #then nativeSkills is undefined", async () => {
    const capturedSkillToolOptions: SkillLoadOptions[] = []
    const localToolFactories = {
      ...toolFactories,
      createSkillTool: mock((options: SkillLoadOptions) => {
        capturedSkillToolOptions.push(options)
        return fakeTool
      }),
    }

    createToolRegistry({
      ctx: {
        directory: "/tmp/project",
        client: { app: {} },
      } as unknown as Parameters<typeof createToolRegistry>[0]["ctx"],
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
      toolFactories: localToolFactories,
    })

    expect(capturedSkillToolOptions[0]?.nativeSkills).toBeUndefined()
  })

  test("#when raw file is present but get is missing #then nativeSkills is undefined", async () => {
    const capturedSkillToolOptions: SkillLoadOptions[] = []
    const localToolFactories = {
      ...toolFactories,
      createSkillTool: mock((options: SkillLoadOptions) => {
        capturedSkillToolOptions.push(options)
        return fakeTool
      }),
    }

    createToolRegistry({
      ctx: {
        directory: "/tmp/project",
        client: { app: {}, _client: {} },
      } as unknown as Parameters<typeof createToolRegistry>[0]["ctx"],
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
      toolFactories: localToolFactories,
    })

    expect(capturedSkillToolOptions[0]?.nativeSkills).toBeUndefined()
  })

  test("#when two concurrent all() calls race #then only one HTTP request is issued", async () => {
    const capturedSkillToolOptions: SkillLoadOptions[] = []
    let resolveRaw: (value: { data: { name: string; description: string; location: string; content: string }[] }) => void = () => {}
    const rawPromise = new Promise<{ data: { name: string; description: string; location: string; content: string }[] }>((resolve) => {
      resolveRaw = resolve
    })
    const rawGet = mock(() => rawPromise)
    const localToolFactories = {
      ...toolFactories,
      createSkillTool: mock((options: SkillLoadOptions) => {
        capturedSkillToolOptions.push(options)
        return fakeTool
      }),
    }

    createToolRegistry({
      ctx: {
        directory: "/tmp/project",
        client: { app: {}, _client: { get: rawGet } },
      } as unknown as Parameters<typeof createToolRegistry>[0]["ctx"],
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
      toolFactories: localToolFactories,
    })

    const nativeSkills = capturedSkillToolOptions[0]?.nativeSkills
    const p1 = nativeSkills?.all()
    const p2 = nativeSkills?.all()

    expect(rawGet).toHaveBeenCalledTimes(1)

    const entries = [{ name: "dedup", description: "D", location: "<built-in>", content: "# D" }]
    resolveRaw({ data: entries })
    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1).toEqual(entries)
    expect(r2).toEqual(entries)
  })
})

describe("#given team_mode configuration", () => {
  test("#when team_mode is enabled #then all 12 team tools are registered", () => {
    syncSessionCreatedCallbacks.length = 0

    const result = createToolRegistry({
      ctx: { directory: "/tmp" } as Parameters<typeof createToolRegistry>[0]["ctx"],
      pluginConfig: createPluginConfig({
        team_mode: {
          enabled: true,
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
      toolFactories,
    })

    for (const teamToolName of TEAM_TOOL_NAMES) {
      expect(result.filteredTools).toHaveProperty(teamToolName)
    }
  })

  test("#when team_mode is disabled #then zero team tools are registered", () => {
    syncSessionCreatedCallbacks.length = 0

    const result = createToolRegistry({
      ctx: { directory: "/tmp" } as Parameters<typeof createToolRegistry>[0]["ctx"],
      pluginConfig: createPluginConfig({
        team_mode: {
          enabled: false,
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
      toolFactories,
    })

    const registeredTeamToolNames = Object.keys(result.filteredTools).filter((toolName) => toolName.startsWith("team_"))

    expect(registeredTeamToolNames).toHaveLength(0)
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
      toolFactories,
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
      toolFactories,
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
      toolFactories,
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
