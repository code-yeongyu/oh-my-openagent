/// <reference types="bun-types" />

import { beforeEach, describe, expect, it, mock } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"

import { OhMyOpenCodeConfigSchema } from "./config/schema/oh-my-opencode-config"
import { createManagers } from "./create-managers"
import type { MonitorManager, MonitorManagerEvent, MonitorOutputQuery, MonitorOutputResult, MonitorRecord, MonitorStartOpts } from "./features/monitor"
import type { createMonitorManager } from "./features/monitor"
import { createModelCacheState } from "./plugin-state"

type CleanupRegistration = {
  shutdown: () => void | Promise<void>
}

const registeredCleanupManagers: CleanupRegistration[] = []
const cleanupCalls: string[] = []
const monitorShutdown = mock(async () => {
  cleanupCalls.push("monitor")
})
let createMonitorManagerOptions: Parameters<typeof createMonitorManager>[0] | undefined

class MockBackgroundManager {
  private readonly onShutdown?: () => void | Promise<void>

  constructor(config: { readonly onShutdown?: () => void | Promise<void> }) {
    this.onShutdown = config.onShutdown
  }

  async shutdown(): Promise<void> {
    await this.onShutdown?.()
  }
}

class MockSkillMcpManager {
  constructor(..._args: unknown[]) {}
}

class MockTmuxSessionManager {
  constructor(_ctx: PluginInput, _config: unknown) {}

  async cleanup(): Promise<void> {
    cleanupCalls.push("tmux")
  }
}

const monitorManager: MonitorManager = {
  async start(_opts: MonitorStartOpts): Promise<MonitorRecord> {
    throw new Error("start should not be called in this test")
  },
  async stop(_id: string): Promise<void> {},
  list(_sessionId: string): MonitorRecord[] {
    return []
  },
  get(_id: string): MonitorRecord | undefined {
    return undefined
  },
  getOutput(_id: string, _opts: MonitorOutputQuery): MonitorOutputResult {
    return {
      lines: [],
      counters: {
        totalLines: 0,
        matchedLines: 0,
        unmatchedLines: 0,
        droppedMatched: 0,
        droppedUnmatched: 0,
        bytesDropped: 0,
        lastSequence: 0,
      },
    }
  },
  async stopSessionMonitors(_sessionId: string): Promise<void> {},
  handleEvent(_event: MonitorManagerEvent): void {},
  shutdown: monitorShutdown,
}

const createMonitorManagerFn = mock((options: Parameters<typeof createMonitorManager>[0]) => {
  createMonitorManagerOptions = options
  return monitorManager
})

function createConfigHandler(): ReturnType<typeof import("./plugin-handlers").createConfigHandler> {
  return async () => {}
}

function initTaskToastManager(): ReturnType<typeof import("./features/task-toast-manager").initTaskToastManager> {
  return {}
}

function registerManagerForCleanup(manager: CleanupRegistration): void {
  registeredCleanupManagers.push(manager)
}

function createTmuxConfig() {
  return {
    enabled: false,
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

function createDeps(): NonNullable<Parameters<typeof createManagers>[0]["deps"]> {
  return {
    BackgroundManagerClass: MockBackgroundManager as typeof import("./features/background-agent").BackgroundManager,
    SkillMcpManagerClass: MockSkillMcpManager as typeof import("./features/skill-mcp-manager").SkillMcpManager,
    TmuxSessionManagerClass: MockTmuxSessionManager as typeof import("./features/tmux-subagent").TmuxSessionManager,
    createMonitorManagerFn,
    initTaskToastManagerFn: initTaskToastManager,
    registerManagerForCleanupFn: registerManagerForCleanup,
    cleanupSessionTeamRunsFn: mock(async () => ({
      cleanedTeamRunIds: [],
      removedLayoutTeamRunIds: [],
      errors: [],
    })) as typeof import("./features/team-mode/team-runtime/session-cleanup").cleanupSessionTeamRuns,
    createConfigHandlerFn: createConfigHandler,
    markServerRunningInProcessFn: mock(() => {}),
  }
}

describe("createManagers monitor", () => {
  beforeEach(() => {
    registeredCleanupManagers.length = 0
    cleanupCalls.length = 0
    createMonitorManagerOptions = undefined
    createMonitorManagerFn.mockClear()
    monitorShutdown.mockClear()
  })

  it("#given monitor is enabled #when managers are created #then it returns a monitor manager", () => {
    const ctx = createContext("/tmp/project")
    const pluginConfig = OhMyOpenCodeConfigSchema.parse({ monitor: { enabled: true } })

    const managers = createManagers({
      ctx,
      pluginConfig,
      tmuxConfig: createTmuxConfig(),
      modelCacheState: createModelCacheState(),
      backgroundNotificationHookEnabled: false,
      deps: createDeps(),
    })

    expect(managers.monitorManager).toBe(monitorManager)
    expect(createMonitorManagerFn).toHaveBeenCalledTimes(1)
    expect(createMonitorManagerOptions).toEqual({
      pluginContext: { client: ctx.client, directory: ctx.directory },
      config: pluginConfig.monitor,
    })
  })

  it("#given monitor is enabled #when managers are created #then cleanup registration is invoked exactly once", () => {
    createManagers({
      ctx: createContext("/tmp/project"),
      pluginConfig: OhMyOpenCodeConfigSchema.parse({ monitor: { enabled: true } }),
      tmuxConfig: createTmuxConfig(),
      modelCacheState: createModelCacheState(),
      backgroundNotificationHookEnabled: false,
      deps: createDeps(),
    })

    expect(registeredCleanupManagers).toHaveLength(1)
  })

  it("#given monitor is enabled #when process cleanup runs #then the monitor manager shuts down once", async () => {
    createManagers({
      ctx: createContext("/tmp/project"),
      pluginConfig: OhMyOpenCodeConfigSchema.parse({ monitor: { enabled: true } }),
      tmuxConfig: createTmuxConfig(),
      modelCacheState: createModelCacheState(),
      backgroundNotificationHookEnabled: false,
      deps: createDeps(),
    })

    await registeredCleanupManagers[0]?.shutdown()

    expect(monitorShutdown).toHaveBeenCalledTimes(1)
    expect(cleanupCalls).toEqual(["tmux", "monitor"])
  })

  it("#given monitor is enabled #when normal background shutdown runs #then the monitor manager shuts down once", async () => {
    const managers = createManagers({
      ctx: createContext("/tmp/project"),
      pluginConfig: OhMyOpenCodeConfigSchema.parse({ monitor: { enabled: true } }),
      tmuxConfig: createTmuxConfig(),
      modelCacheState: createModelCacheState(),
      backgroundNotificationHookEnabled: false,
      deps: createDeps(),
    })

    await managers.backgroundManager.shutdown()

    expect(monitorShutdown).toHaveBeenCalledTimes(1)
    expect(cleanupCalls).toEqual(["tmux", "monitor"])
  })
})
