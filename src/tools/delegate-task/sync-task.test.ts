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
    const mockClient = {
      session: {
        create: async () => ({ data: { id: "ses_test_12345678" } }),
      },
    }

    const { executeSyncTask } = require("./sync-task")

    const deps = {
      createSyncSession: async () => ({ ok: true, sessionID: "ses_test_12345678" }),
      sendSyncPrompt: async () => null,
      pollSyncSession: async () => null,
      fetchSyncResult: async () => ({ ok: false as const, error: "Fetch failed" }),
    }

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
    }, "test-agent", undefined, undefined, undefined, deps)

    //#then - should return error and cleanup resources
    expect(result).toBe("Fetch failed")
    expect(removeTaskCalls.length).toBe(1)
    expect(removeTaskCalls[0]).toBe("sync_ses_test")
    expect(deleteCalls.length).toBe(1)
    expect(deleteCalls[0]).toBe("ses_test_12345678")
  })

  test("cleans up toast and subagentSessions when pollSyncSession returns error", async () => {
    const mockClient = {
      session: {
        create: async () => ({ data: { id: "ses_test_12345678" } }),
      },
    }

    const { executeSyncTask } = require("./sync-task")

    const deps = {
      createSyncSession: async () => ({ ok: true, sessionID: "ses_test_12345678" }),
      sendSyncPrompt: async () => null,
      pollSyncSession: async () => "Poll error",
      fetchSyncResult: async () => ({ ok: true as const, textContent: "Result" }),
    }

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
    }, "test-agent", undefined, undefined, undefined, deps)

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

    const deps = {
      createSyncSession: async () => ({ ok: true, sessionID: "ses_test_12345678" }),
      sendSyncPrompt: async () => null,
      pollSyncSession: async () => null,
      fetchSyncResult: async () => ({ ok: true as const, textContent: "Result" }),
    }

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
    }, "test-agent", undefined, undefined, undefined, deps)

    //#then - should complete and cleanup resources
    expect(result).toContain("Task completed")
    expect(removeTaskCalls.length).toBe(1)
    expect(removeTaskCalls[0]).toBe("sync_ses_test")
    expect(deleteCalls.length).toBe(1)
    expect(deleteCalls[0]).toBe("ses_test_12345678")
  })
})
