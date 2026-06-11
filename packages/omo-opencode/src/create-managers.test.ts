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

let backgroundManagerOptions: {
  onSubagentSessionCreated?: (event: { sessionID: string; parentID: string; title: string }) => Promise<void>
} | null = null
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
    dispatchOpenClawEvent.mockReset()
    backgroundManagerOptions = null
    trackedPaneBySession.clear()
    registeredCleanupManagers.length = 0
    cleanupSessionTeamRunsMock.mockClear()
  })

  afterEach(() => {
    dispatchOpenClawEvent.mockRestore()
  })

  it("#given tmux integration is enabled #when managers are created #then TmuxSessionManager is constructed (server readiness is now deferred to isServerRunning health check)", () => {
    const args = {
      ctx: createContext("/tmp"),
      pluginConfig: OhMyOpenCodeConfigSchema.parse({}),
      tmuxConfig: createTmuxConfig(true),
      modelCacheState: createModelCacheState(),
      backgroundNotificationHookEnabled: false,
      deps: createDeps(),
    }

    createManagers(args)

    // markServerRunningInProcess was removed.  The server readiness check
    // is now delegated to isServerRunning() which performs a real HTTP
    // health check.  TmuxSessionManager still initializes, but spawns
    // will only proceed if the health check passes (real HTTP server).
    expect(MockTmuxSessionManager).toHaveBeenCalledTimes(1)
  })

  it("#given tmux is enabled #when managers are created #then the in-process mark is never set (server readiness verified by HTTP health check)", () => {
    // Regardless of tmux config or ctx.serverUrl, we no longer
    // markServerRunningInProcess.  The isServerRunning() function
    // performs a real HTTP health check before each spawn.
    // This prevents false positives when `opencode` runs in default
    // TUI mode (internal RPC, no HTTP listener).

    const ctx = createContext("/tmp")
    const ctxWithoutServerUrl = { ...ctx, serverUrl: undefined as unknown as URL }

    for (const ctxVariant of [ctx, ctxWithoutServerUrl]) {
      for (const enabled of [true, false]) {
        const args = {
          ctx: ctxVariant,
          pluginConfig: OhMyOpenCodeConfigSchema.parse({}),
          tmuxConfig: createTmuxConfig(enabled),
          modelCacheState: createModelCacheState(),
          backgroundNotificationHookEnabled: false,
          deps: createDeps(),
        }

        createManagers(args)
      }
    }

    // markServerRunningInProcess is never called — the logic was removed.
    // Server availability is verified lazily by isServerRunning().
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
