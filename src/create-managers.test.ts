/// <reference types="bun-types" />

import { afterAll, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"

import * as openclawRuntimeDispatch from "./openclaw/runtime-dispatch"

const markServerRunningInProcess = mock(() => {})
let backgroundManagerOptions: {
  onSubagentSessionCreated?: (event: { sessionID: string; parentID: string; title: string }) => Promise<void>
} | null = null
const trackedPaneBySession = new Map<string, string>()

mock.module("./features/background-agent", () => ({
  BackgroundManager: class BackgroundManager {
    constructor(_ctx: unknown, _config: unknown, options: typeof backgroundManagerOptions) {
      backgroundManagerOptions = options
    }
  },
}))

mock.module("./features/skill-mcp-manager", () => ({
  SkillMcpManager: class SkillMcpManager {
    constructor(..._args: unknown[]) {}
  },
}))

mock.module("./features/task-toast-manager", () => ({
  initTaskToastManager: mock(() => {}),
}))

mock.module("./features/tmux-subagent", () => ({
  TmuxSessionManager: class TmuxSessionManager {
    constructor(..._args: unknown[]) {}

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
  },
}))

mock.module("./features/background-agent/process-cleanup", () => ({
  registerManagerForCleanup: mock(() => {}),
}))

mock.module("./plugin-handlers", () => ({
  createConfigHandler: mock(() => ({ kind: "config-handler" })),
}))

mock.module("./shared/tmux/tmux-utils/server-health", () => ({
  isServerRunning: mock(async () => true),
  markServerRunningInProcess,
  resetServerCheck: mock(() => {}),
}))

const { createManagers } = await import("./create-managers")

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

describe("createManagers", () => {
  const dispatchOpenClawEvent = spyOn(openclawRuntimeDispatch, "dispatchOpenClawEvent")

  beforeEach(() => {
    markServerRunningInProcess.mockClear()
    dispatchOpenClawEvent.mockReset()
    backgroundManagerOptions = null
    trackedPaneBySession.clear()
  })

  afterAll(() => {
    mock.restore()
  })

  it("#given tmux integration is disabled #when managers are created #then it does not mark the tmux server as running", () => {
    const args = {
      ctx: { directory: "/tmp", client: {} },
      pluginConfig: {},
      tmuxConfig: createTmuxConfig(false),
      modelCacheState: {},
      backgroundNotificationHookEnabled: false,
    } as Parameters<typeof createManagers>[0]

    createManagers(args)

    expect(markServerRunningInProcess).not.toHaveBeenCalled()
  })

  it("#given tmux integration is enabled #when managers are created #then it marks the tmux server as running", () => {
    const args = {
      ctx: { directory: "/tmp", client: {} },
      pluginConfig: {},
      tmuxConfig: createTmuxConfig(true),
      modelCacheState: {},
      backgroundNotificationHookEnabled: false,
    } as Parameters<typeof createManagers>[0]

    createManagers(args)

    expect(markServerRunningInProcess).toHaveBeenCalledTimes(1)
  })

  it("#given openclaw is enabled #when the background session-created callback runs #then it dispatches openclaw with the tracked pane id", async () => {
    const args = {
      ctx: { directory: "/tmp/project", client: {} },
      pluginConfig: {
        openclaw: {
          enabled: true,
          gateways: {},
          hooks: {},
        },
      },
      tmuxConfig: createTmuxConfig(true),
      modelCacheState: {},
      backgroundNotificationHookEnabled: false,
    } as Parameters<typeof createManagers>[0]

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
})
