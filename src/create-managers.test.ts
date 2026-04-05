/// <reference types="bun-types" />

import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test"

const markServerRunningInProcess = mock(() => {})

mock.module("./features/background-agent", () => ({
  BackgroundManager: class BackgroundManager {
    constructor(..._args: unknown[]) {}
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
    async onSessionCreated(..._args: unknown[]): Promise<void> {}
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
  beforeEach(() => {
    markServerRunningInProcess.mockClear()
  })

  afterAll(() => {
    mock.restore()
  })

  it("#given tmux integration is disabled #when managers are created #then it does not mark the tmux server as running", () => {
    // #given
    const args = {
      ctx: { directory: "/tmp", client: {} },
      pluginConfig: {},
      tmuxConfig: createTmuxConfig(false),
      modelCacheState: {},
      backgroundNotificationHookEnabled: false,
    } as Parameters<typeof createManagers>[0]

    // #when
    createManagers(args)

    // #then
    expect(markServerRunningInProcess).not.toHaveBeenCalled()
  })

  it("#given tmux integration is enabled #when managers are created #then it marks the tmux server as running", () => {
    // #given
    const args = {
      ctx: { directory: "/tmp", client: {} },
      pluginConfig: {},
      tmuxConfig: createTmuxConfig(true),
      modelCacheState: {},
      backgroundNotificationHookEnabled: false,
    } as Parameters<typeof createManagers>[0]

    // #when
    createManagers(args)

    // #then
    expect(markServerRunningInProcess).toHaveBeenCalledTimes(1)
  })
})
