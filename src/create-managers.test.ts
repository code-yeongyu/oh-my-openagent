/// <reference types="bun-types" />

import { beforeEach, describe, expect, it, mock } from "bun:test"

import { createManagers } from "./create-managers"

class MockBackgroundManager {
  constructor(..._args: unknown[]) {}
}

class MockSkillMcpManager {
  constructor(..._args: unknown[]) {}
}

class MockTmuxSessionManager {
  constructor(..._args: unknown[]) {}

  async cleanup(): Promise<void> {}
  async onSessionCreated(..._args: unknown[]): Promise<void> {}
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

describe("createManagers", () => {
  const markServerRunningInProcess = mock(() => {})
  const initTaskToastManager = mock(() => ({}) as never)
  const registerManagerForCleanup = mock(() => {})
  const createConfigHandler = mock(() => (async () => {}) as never)

  function createMockArgs(enabled: boolean): Parameters<typeof createManagers>[0] {
    return {
      ctx: {
        directory: "/tmp",
        client: {} as never,
        project: {} as never,
        worktree: "/tmp",
        serverUrl: new URL("https://example.com"),
        $: Bun.$,
      },
      pluginConfig: {} as never,
      tmuxConfig: createTmuxConfig(enabled),
      modelCacheState: {} as never,
      backgroundNotificationHookEnabled: false,
      deps: {
        BackgroundManagerClass: MockBackgroundManager as never,
        SkillMcpManagerClass: MockSkillMcpManager as never,
        TmuxSessionManagerClass: MockTmuxSessionManager as never,
        initTaskToastManagerFn: initTaskToastManager,
        registerManagerForCleanupFn: registerManagerForCleanup,
        createConfigHandlerFn: createConfigHandler,
        markServerRunningInProcessFn: markServerRunningInProcess,
      },
    }
  }

  beforeEach(() => {
    markServerRunningInProcess.mockClear()
    initTaskToastManager.mockClear()
    registerManagerForCleanup.mockClear()
    createConfigHandler.mockClear()
  })

  it("#given tmux integration is disabled #when managers are created #then it does not mark the tmux server as running", () => {
    // #given
    const args = createMockArgs(false)

    // #when
    createManagers(args)

    // #then
    expect(markServerRunningInProcess).not.toHaveBeenCalled()
  })

  it("#given tmux integration is enabled #when managers are created #then it marks the tmux server as running", () => {
    // #given
    const args = createMockArgs(true)

    // #when
    createManagers(args)

    // #then
    expect(markServerRunningInProcess).toHaveBeenCalledTimes(1)
  })
})
