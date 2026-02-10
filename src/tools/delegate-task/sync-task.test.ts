const { describe, test, expect, beforeEach, afterEach, mock, spyOn } = require("bun:test")

describe("executeSyncTask - cleanup on error paths", () => {
  let removeTaskCalls: string[] = []
  let addTaskCalls: any[] = []
  let deleteCalls: string[] = []
  let addCalls: string[] = []
  let resetToastManager: (() => void) | null = null

  beforeEach(() => {
    //#given - configure fast timing for all tests
    const { __setTimingConfig } = require("./timing")
    __setTimingConfig({
      POLL_INTERVAL_MS: 10,
      MIN_STABILITY_TIME_MS: 0,
      STABILITY_POLLS_REQUIRED: 1,
      MAX_POLL_TIME_MS: 100,
    })

    //#given - reset call tracking
    removeTaskCalls = []
    addTaskCalls = []
    deleteCalls = []
    addCalls = []

    //#given - initialize real task toast manager (avoid global module mocks)
    const { initTaskToastManager, _resetTaskToastManagerForTesting } = require("../../features/task-toast-manager/manager")
    _resetTaskToastManagerForTesting()
    resetToastManager = _resetTaskToastManagerForTesting

    const toastManager = initTaskToastManager({
      tui: { showToast: mock(() => Promise.resolve()) },
    })

    spyOn(toastManager, "addTask").mockImplementation((task: any) => {
      addTaskCalls.push(task)
    })
    spyOn(toastManager, "removeTask").mockImplementation((id: string) => {
      removeTaskCalls.push(id)
    })

    //#given - mock subagentSessions
    const { subagentSessions } = require("../../features/claude-code-session-state")
    spyOn(subagentSessions, "add").mockImplementation((id: string) => {
      addCalls.push(id)
    })
    spyOn(subagentSessions, "delete").mockImplementation((id: string) => {
      deleteCalls.push(id)
    })

    //#given - mock other dependencies
    mock.module("./sync-session-creator.ts", () => ({
      createSyncSession: async () => ({ ok: true, sessionID: "ses_test_12345678" }),
    }))

    mock.module("./sync-prompt-sender.ts", () => ({
      sendSyncPrompt: async () => null,
    }))

    mock.module("./sync-session-poller.ts", () => ({
      pollSyncSession: async () => null,
    }))

    mock.module("./sync-result-fetcher.ts", () => ({
      fetchSyncResult: async () => ({ ok: true, textContent: "Result" }),
    }))
  })

  afterEach(() => {
    //#given - reset timing after each test
    const { __resetTimingConfig } = require("./timing")
    __resetTimingConfig()

    mock.restore()
    resetToastManager?.()
    resetToastManager = null
  })

  test("cleans up toast and subagentSessions when fetchSyncResult returns ok: false", async () => {
    //#given - mock fetchSyncResult to return error
    mock.module("./sync-result-fetcher.ts", () => ({
      fetchSyncResult: async () => ({ ok: false, error: "Fetch failed" }),
    }))

    const mockClient = {
      session: {
        create: async () => ({ data: { id: "ses_test_12345678" } }),
      },
    }

    const { executeSyncTask } = require("./sync-task")

    const mockCtx = {
      sessionID: "parent-session",
      callID: "call-123",
      metadata: () => {},
    }

    const mockExecutorCtx = {
      client: mockClient,
      directory: "/tmp",
      onSyncSessionCreated: null,
    }

    const args = {
      prompt: "test prompt",
      description: "test task",
      category: "test",
      load_skills: [],
      run_in_background: false,
      command: null,
    }

    //#when - executeSyncTask with fetchSyncResult failing
    const result = await executeSyncTask(args, mockCtx, mockExecutorCtx, {
      sessionID: "parent-session",
    }, "test-agent", undefined, undefined)

    //#then - should return error and cleanup resources
    expect(result).toBe("Fetch failed")
    expect(removeTaskCalls.length).toBe(1)
    expect(removeTaskCalls[0]).toBe("sync_ses_test")
    expect(deleteCalls.length).toBe(1)
    expect(deleteCalls[0]).toBe("ses_test_12345678")
  })

  test("cleans up toast and subagentSessions when pollSyncSession returns error", async () => {
    //#given - mock pollSyncSession to return error
    mock.module("./sync-session-poller.ts", () => ({
      pollSyncSession: async () => "Poll error",
    }))

    const mockClient = {
      session: {
        create: async () => ({ data: { id: "ses_test_12345678" } }),
      },
    }

    const { executeSyncTask } = require("./sync-task")

    const mockCtx = {
      sessionID: "parent-session",
      callID: "call-123",
      metadata: () => {},
    }

    const mockExecutorCtx = {
      client: mockClient,
      directory: "/tmp",
      onSyncSessionCreated: null,
    }

    const args = {
      prompt: "test prompt",
      description: "test task",
      category: "test",
      load_skills: [],
      run_in_background: false,
      command: null,
    }

    //#when - executeSyncTask with pollSyncSession failing
    const result = await executeSyncTask(args, mockCtx, mockExecutorCtx, {
      sessionID: "parent-session",
    }, "test-agent", undefined, undefined)

    //#then - should return error and cleanup resources
    expect(result).toBe("Poll error")
    expect(removeTaskCalls.length).toBe(1)
    expect(removeTaskCalls[0]).toBe("sync_ses_test")
    expect(deleteCalls.length).toBe(1)
    expect(deleteCalls[0]).toBe("ses_test_12345678")
  })

  test("cleans up toast and subagentSessions on successful completion", async () => {
    const mockClient = {
      session: {
        create: async () => ({ data: { id: "ses_test_12345678" } }),
      },
    }

    const { executeSyncTask } = require("./sync-task")

    const mockCtx = {
      sessionID: "parent-session",
      callID: "call-123",
      metadata: () => {},
    }

    const mockExecutorCtx = {
      client: mockClient,
      directory: "/tmp",
      onSyncSessionCreated: null,
    }

    const args = {
      prompt: "test prompt",
      description: "test task",
      category: "test",
      load_skills: [],
      run_in_background: false,
      command: null,
    }

    //#when - executeSyncTask completes successfully
    const result = await executeSyncTask(args, mockCtx, mockExecutorCtx, {
      sessionID: "parent-session",
    }, "test-agent", undefined, undefined)

    //#then - should complete and cleanup resources
    expect(result).toContain("Task completed")
    expect(removeTaskCalls.length).toBe(1)
    expect(removeTaskCalls[0]).toBe("sync_ses_test")
    expect(deleteCalls.length).toBe(1)
    expect(deleteCalls[0]).toBe("ses_test_12345678")
  })
})