/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"

import { OhMyOpenCodeConfigSchema } from "./config/schema/oh-my-opencode-config"
import { createManagers, resetBackgroundManagerSingletonsForTesting } from "./create-managers"
import * as openclawRuntimeDispatch from "./openclaw/runtime-dispatch"
import { createModelCacheState } from "./plugin-state"

type CleanupRegistration = {
  shutdown: () => void | Promise<void>
}

type CleanupSessionTeamRunsFn = typeof import("./features/team-mode/team-runtime/session-cleanup").cleanupSessionTeamRuns

const markServerRunningInProcess = mock(() => {})
let backgroundManagerOptions: {
  onSubagentSessionCreated?: (event: { sessionID: string; parentID: string; title: string }) => Promise<void>
} | null = null
let backgroundManagerConstructorCalls = 0
let backgroundManagerUpdateCalls = 0
const trackedPaneBySession = new Map<string, string>()
const registeredCleanupManagers: CleanupRegistration[] = []
const cleanupSessionTeamRunsMock = mock(async () => ({
  cleanedTeamRunIds: [],
  removedLayoutTeamRunIds: [],
  errors: [],
}))

class MockBackgroundManager {
  constructor(config: {
    onSubagentSessionCreated?: (event: { sessionID: string; parentID: string; title: string }) => Promise<void>
  }) {
    backgroundManagerConstructorCalls += 1
    backgroundManagerOptions = config
  }

  updateRuntimeBindings(config: {
    onSubagentSessionCreated?: (event: { sessionID: string; parentID: string; title: string }) => Promise<void>
  }): void {
    backgroundManagerUpdateCalls += 1
    backgroundManagerOptions = config
  }
}

class MockSkillMcpManager {
  constructor(..._args: unknown[]) {}
}

class MockTmuxSessionManager {
  constructor(_ctx: PluginInput, _config: unknown) {}

  async cleanup(): Promise<void> {}

  async onSessionCreated(event: { properties?: { info?: { id?: string } } }): Promise<void> {
    const sessionID = event.properties?.info?.id
    if (sessionID) {
      trackedPaneBySession.set(sessionID, `%pane-${sessionID}`)
    }
  }

  getTrackedPaneId(sessionID: string): string | undefined {
    return trackedPaneBySession.get(sessionID)
  }
}

function createConfigHandler(): ReturnType<typeof import("./plugin-handlers").createConfigHandler> {
  return async () => {}
}

function initTaskToastManager(): ReturnType<typeof import("./features/task-toast-manager").initTaskToastManager> {
  return {} as ReturnType<typeof import("./features/task-toast-manager").initTaskToastManager>
}

function registerManagerForCleanup(manager: CleanupRegistration): void {
  registeredCleanupManagers.push(manager)
}

function createDeps(): NonNullable<Parameters<typeof createManagers>[0]["deps"]> {
  return {
    BackgroundManagerClass: MockBackgroundManager as typeof import("./features/background-agent").BackgroundManager,
    SkillMcpManagerClass: MockSkillMcpManager as typeof import("./features/skill-mcp-manager").SkillMcpManager,
    TmuxSessionManagerClass: MockTmuxSessionManager as typeof import("./features/tmux-subagent").TmuxSessionManager,
    initTaskToastManagerFn: initTaskToastManager,
    registerManagerForCleanupFn: registerManagerForCleanup,
    cleanupSessionTeamRunsFn: cleanupSessionTeamRunsMock as CleanupSessionTeamRunsFn,
    createConfigHandlerFn: createConfigHandler,
    markServerRunningInProcessFn: markServerRunningInProcess,
  }
}

function createTmuxConfig(enabled: boolean) {
  return {
    enabled,
    layout: "main-vertical" as const,
    main_pane_size: 60,
    main_pane_min_width: 120,
    agent_pane_min_width: 40,
    isolation: "inline" as const,
  }
}

function createContext(directory: string): PluginInput {
  const shell = Object.assign(
    () => {
      throw new Error("shell should not be called in this test")
    },
    {
      braces: () => [],
      escape: (input: string) => input,
      env() {
        return shell
      },
      cwd() {
        return shell
      },
      nothrow() {
        return shell
      },
      throws() {
        return shell
      },
    },
  )

  return {
    project: {
      id: "project-id",
      worktree: directory,
      time: { created: Date.now() },
    },
    directory,
    worktree: directory,
    serverUrl: new URL("http://localhost:4096"),
    $: shell,
    client: {} as PluginInput["client"],
  }
}

describe("createManagers", () => {
  let dispatchOpenClawEvent: ReturnType<typeof spyOn>

  beforeEach(() => {
    dispatchOpenClawEvent = spyOn(openclawRuntimeDispatch, "dispatchOpenClawEvent")
    markServerRunningInProcess.mockClear()
    dispatchOpenClawEvent.mockReset()
    backgroundManagerOptions = null
    backgroundManagerConstructorCalls = 0
    backgroundManagerUpdateCalls = 0
    trackedPaneBySession.clear()
    registeredCleanupManagers.length = 0
    cleanupSessionTeamRunsMock.mockClear()
    resetBackgroundManagerSingletonsForTesting()
  })

  afterEach(() => {
    dispatchOpenClawEvent.mockRestore()
  })

  it("#given tmux integration is disabled #when managers are created #then it does not mark the tmux server as running", () => {
    const args = {
      ctx: createContext("/tmp"),
      pluginConfig: OhMyOpenCodeConfigSchema.parse({}),
      tmuxConfig: createTmuxConfig(false),
      modelCacheState: createModelCacheState(),
      backgroundNotificationHookEnabled: false,
      deps: createDeps(),
    }

    createManagers(args)

    expect(markServerRunningInProcess).not.toHaveBeenCalled()
  })

  it("#given tmux integration is enabled #when managers are created #then it marks the tmux server as running", () => {
    const args = {
      ctx: createContext("/tmp"),
      pluginConfig: OhMyOpenCodeConfigSchema.parse({}),
      tmuxConfig: createTmuxConfig(true),
      modelCacheState: createModelCacheState(),
      backgroundNotificationHookEnabled: false,
      deps: createDeps(),
    }

    createManagers(args)

    expect(markServerRunningInProcess).toHaveBeenCalledTimes(1)
  })

  it("#given tmux is enabled but ctx.serverUrl is undefined #when managers are created #then it does NOT mark the server as running (issue #3894)", () => {
    // Vanilla `opencode` (no `opencode serve` / `opencode web`) leaves
    // ctx.serverUrl undefined. Marking the server as in-process running
    // would short-circuit isServerRunning() in createTeamLayout, letting
    // it spawn tmux panes whose `opencode attach` then fails because no
    // server is actually listening on the fallback port.
    const ctx = createContext("/tmp")
    const ctxWithoutServerUrl = { ...ctx, serverUrl: undefined as unknown as URL }
    const args = {
      ctx: ctxWithoutServerUrl,
      pluginConfig: OhMyOpenCodeConfigSchema.parse({}),
      tmuxConfig: createTmuxConfig(true),
      modelCacheState: createModelCacheState(),
      backgroundNotificationHookEnabled: false,
      deps: createDeps(),
    }

    createManagers(args)

    expect(markServerRunningInProcess).not.toHaveBeenCalled()
  })

  it("#given the plugin initializes twice for the same project #when managers are created #then the background manager is reused", () => {
    const args = {
      ctx: createContext("/tmp/project"),
      pluginConfig: OhMyOpenCodeConfigSchema.parse({}),
      tmuxConfig: createTmuxConfig(false),
      modelCacheState: createModelCacheState(),
      backgroundNotificationHookEnabled: false,
      deps: createDeps(),
    }

    const firstManagers = createManagers(args)
    const secondManagers = createManagers(args)

    expect(secondManagers.backgroundManager).toBe(firstManagers.backgroundManager)
    expect(backgroundManagerConstructorCalls).toBe(1)
    expect(backgroundManagerUpdateCalls).toBe(1)
  })

  it("#given the plugin initializes twice for the same project #when the background session callback runs #then it uses the latest tmux manager", async () => {
    const firstArgs = {
      ctx: createContext("/tmp/project"),
      pluginConfig: OhMyOpenCodeConfigSchema.parse({}),
      tmuxConfig: createTmuxConfig(false),
      modelCacheState: createModelCacheState(),
      backgroundNotificationHookEnabled: false,
      deps: createDeps(),
    }
    const secondArgs = {
      ...firstArgs,
      tmuxConfig: createTmuxConfig(true),
    }

    createManagers(firstArgs)
    trackedPaneBySession.clear()
    createManagers(secondArgs)

    await backgroundManagerOptions?.onSubagentSessionCreated?.({
      sessionID: "ses-bg-latest",
      parentID: "ses-parent",
      title: "child task",
    })

    expect(trackedPaneBySession.get("ses-bg-latest")).toBe("%pane-ses-bg-latest")
    expect(backgroundManagerConstructorCalls).toBe(1)
    expect(backgroundManagerUpdateCalls).toBe(1)
  })

  it("#given openclaw is enabled #when the background session-created callback runs #then it dispatches openclaw with the tracked pane id", async () => {
    const args = {
      ctx: createContext("/tmp/project"),
      pluginConfig: OhMyOpenCodeConfigSchema.parse({
        openclaw: {
          enabled: true,
          gateways: {},
          hooks: {},
        },
      }),
      tmuxConfig: createTmuxConfig(true),
      modelCacheState: createModelCacheState(),
      backgroundNotificationHookEnabled: false,
      deps: createDeps(),
    }

    createManagers(args)

    await backgroundManagerOptions?.onSubagentSessionCreated?.({
      sessionID: "ses-bg-1",
      parentID: "ses-parent",
      title: "child task",
    })

    expect(dispatchOpenClawEvent).toHaveBeenCalledTimes(1)
    expect(dispatchOpenClawEvent).toHaveBeenCalledWith({
      config: args.pluginConfig.openclaw,
      rawEvent: "session.created",
      context: {
        sessionId: "ses-bg-1",
        projectPath: "/tmp/project",
        tmuxPaneId: "%pane-ses-bg-1",
      },
    })
  })

  it("#given team mode is enabled #when process cleanup runs #then session team runs are cleaned with tmux visualization dependencies", async () => {
    const args = {
      ctx: createContext("/tmp/project"),
      pluginConfig: OhMyOpenCodeConfigSchema.parse({
        team_mode: {
          enabled: true,
          tmux_visualization: true,
        },
      }),
      tmuxConfig: createTmuxConfig(true),
      modelCacheState: createModelCacheState(),
      backgroundNotificationHookEnabled: false,
      deps: createDeps(),
    }

    createManagers(args)

    await registeredCleanupManagers[0]?.shutdown()

    expect(cleanupSessionTeamRunsMock).toHaveBeenCalledTimes(1)
    const cleanupArgs = cleanupSessionTeamRunsMock.mock.calls[0]?.[0]
    expect(cleanupArgs).toMatchObject({
      config: args.pluginConfig.team_mode,
    })
    expect(cleanupArgs?.tmuxMgr).toBeInstanceOf(MockTmuxSessionManager)
    expect(cleanupArgs?.bgMgr).toBeInstanceOf(MockBackgroundManager)
  })
})
