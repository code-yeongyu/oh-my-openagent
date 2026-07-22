/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"

import { OhMyOpenCodeConfigSchema } from "./config/schema/oh-my-opencode-config"
import { createManagers } from "./create-managers"
import * as openclawRuntimeDispatch from "./openclaw/runtime-dispatch"
import { createModelCacheState } from "./plugin-state"

type CleanupRegistration = {
  shutdown: () => void | Promise<void>
}

type CleanupSessionTeamRunsFn = typeof import("./features/team-mode/team-runtime/session-cleanup").cleanupSessionTeamRuns

const markServerRunningInProcess = mock(() => {})
let backgroundManagerOptions: {
  onSubagentSessionCreated?: (event: { sessionID: string; parentID: string; title: string; signal: AbortSignal }) => Promise<void>
  onShutdown?: () => void | Promise<void>
} | null = null
const trackedPaneBySession = new Map<string, string>()
const registeredCleanupManagers: CleanupRegistration[] = []
const cleanupSessionTeamRunsCalls: Array<Parameters<CleanupSessionTeamRunsFn>[0]> = []
const cleanupSessionTeamRunsMock = mock(async (input: Parameters<CleanupSessionTeamRunsFn>[0]) => {
  cleanupSessionTeamRunsCalls.push(input)
  return {
    cleanedTeamRunIds: [],
    removedLayoutTeamRunIds: [],
    errors: [],
  }
})
const tuiMirrorConstructedInputs: unknown[] = []
let tuiMirrorStartCount = 0
let tuiMirrorStopCount = 0

class MockBackgroundManager {
  constructor(config: {
    onSubagentSessionCreated?: (event: { sessionID: string; parentID: string; title: string; signal: AbortSignal }) => Promise<void>
    onShutdown?: () => void | Promise<void>
  }) {
    backgroundManagerOptions = config
  }

  async shutdown(): Promise<void> {
    await backgroundManagerOptions?.onShutdown?.()
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

  async onSessionDeleted(event: { sessionID: string }): Promise<void> {
    trackedPaneBySession.delete(event.sessionID)
  }
}

class MockTuiStateMirror {
  constructor(input: unknown) {
    tuiMirrorConstructedInputs.push(input)
  }

  start(): void {
    tuiMirrorStartCount += 1
  }

  stop(): void {
    tuiMirrorStopCount += 1
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
    TuiStateMirrorClass: MockTuiStateMirror as typeof import("./features/tui-sidebar/mirror-manager").TuiStateMirror,
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
    experimental_workspace: { register: () => {} },
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
    trackedPaneBySession.clear()
    registeredCleanupManagers.length = 0
    cleanupSessionTeamRunsCalls.length = 0
    cleanupSessionTeamRunsMock.mockClear()
    tuiMirrorConstructedInputs.length = 0
    tuiMirrorStartCount = 0
    tuiMirrorStopCount = 0
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
      signal: new AbortController().signal,
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

  it("#given shutdown begins during openclaw dispatch #when dispatch settles #then it removes the tracked pane", async () => {
    const dispatchStarted = Promise.withResolvers<void>()
    const releaseDispatch = Promise.withResolvers<void>()
    dispatchOpenClawEvent.mockImplementation(async () => {
      dispatchStarted.resolve()
      await releaseDispatch.promise
    })
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
    const abortController = new AbortController()

    createManagers(args)

    const callback = backgroundManagerOptions?.onSubagentSessionCreated?.({
      sessionID: "ses-bg-shutdown-dispatch",
      parentID: "ses-parent",
      title: "child task",
      signal: abortController.signal,
    })
    await dispatchStarted.promise

    // when
    abortController.abort()
    releaseDispatch.resolve()
    await callback

    // then
    expect(trackedPaneBySession.has("ses-bg-shutdown-dispatch")).toBe(false)
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
    const cleanupArgs = cleanupSessionTeamRunsCalls[0]
    if (cleanupArgs === undefined) {
      throw new Error("cleanupSessionTeamRuns was not called")
    }
    expect(cleanupArgs).toMatchObject({
      config: args.pluginConfig.team_mode,
    })
    expect(cleanupArgs?.tmuxMgr).toBeInstanceOf(MockTmuxSessionManager)
    expect(cleanupArgs?.bgMgr).toBeInstanceOf(MockBackgroundManager)
  })

  it("#given TuiStateMirror is enabled #when managers are created and cleanup runs #then it starts and stops the mirror", async () => {
    const args = {
      ctx: createContext("/tmp/project"),
      pluginConfig: OhMyOpenCodeConfigSchema.parse({}),
      tmuxConfig: createTmuxConfig(false),
      modelCacheState: createModelCacheState(),
      backgroundNotificationHookEnabled: false,
      deps: createDeps(),
    }

    const managers = createManagers(args)

    await registeredCleanupManagers[0]?.shutdown()

    expect(managers.tuiStateMirror).toBeInstanceOf(MockTuiStateMirror)
    expect(tuiMirrorConstructedInputs).toHaveLength(1)
    expect(tuiMirrorConstructedInputs[0]).toMatchObject({
      client: args.ctx.client,
      projectDir: "/tmp/project",
      backgroundManager: managers.backgroundManager,
    })
    expect(tuiMirrorStartCount).toBe(1)
    expect(tuiMirrorStopCount).toBe(1)
  })

  it("#given TuiStateMirror is enabled #when normal shutdown runs #then it stops the mirror", async () => {
    const args = {
      ctx: createContext("/tmp/project"),
      pluginConfig: OhMyOpenCodeConfigSchema.parse({}),
      tmuxConfig: createTmuxConfig(false),
      modelCacheState: createModelCacheState(),
      backgroundNotificationHookEnabled: false,
      deps: createDeps(),
    }

    const managers = createManagers(args)

    await managers.backgroundManager.shutdown()

    expect(managers.tuiStateMirror).toBeInstanceOf(MockTuiStateMirror)
    expect(tuiMirrorStartCount).toBe(1)
    expect(tuiMirrorStopCount).toBe(1)
  })

  it("#given TuiStateMirror is disabled #when managers are created #then it is not constructed or started", () => {
    const args = {
      ctx: createContext("/tmp/project"),
      pluginConfig: OhMyOpenCodeConfigSchema.parse({
        tui: { sidebar: { enabled: false } },
      }),
      tmuxConfig: createTmuxConfig(false),
      modelCacheState: createModelCacheState(),
      backgroundNotificationHookEnabled: false,
      deps: createDeps(),
    }

    const managers = createManagers(args)

    expect(managers.tuiStateMirror).toBeUndefined()
    expect(tuiMirrorConstructedInputs).toHaveLength(0)
    expect(tuiMirrorStartCount).toBe(0)
  })
})
