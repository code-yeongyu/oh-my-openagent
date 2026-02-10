const { describe, test, expect, beforeEach, afterEach, mock, spyOn } = require("bun:test")

describe("executeSyncContinuation - toast cleanup error paths", () => {
  let removeTaskCalls: string[] = []
  let addTaskCalls: any[] = []
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

    //#given - mock other dependencies
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

  test("removes toast when fetchSyncResult throws", async () => {
    //#given - mock fetchSyncResult to throw an error
    mock.module("./sync-result-fetcher.ts", () => ({
      fetchSyncResult: async () => {
        throw new Error("Network error")
      },
    }))

    const mockClient = {
      session: {
        messages: async () => ({
          data: [
            { info: { id: "msg_001", role: "user", time: { created: 1000 } } },
            {
              info: { id: "msg_002", role: "assistant", time: { created: 2000 }, finish: "end_turn" },
              parts: [{ type: "text", text: "Response" }],
            },
          ],
        }),
        promptAsync: async () => ({}),
        status: async () => ({
          data: { ses_test: { type: "idle" } },
        }),
      },
    }

    const { executeSyncContinuation } = require("./sync-continuation")

    const mockCtx = {
      sessionID: "parent-session",
      callID: "call-123",
      metadata: () => {},
    }

    const mockExecutorCtx = {
      client: mockClient,
    }

    const args = {
      session_id: "ses_test_12345678",
      prompt: "test prompt",
      description: "test task",
      load_skills: [],
      run_in_background: false,
    }

    //#when - executeSyncContinuation with fetchSyncResult throwing
    let error: any = null
    let result: string | null = null
    try {
      result = await executeSyncContinuation(args, mockCtx, mockExecutorCtx)
    } catch (e) {
      error = e
    }

    //#then - error should be thrown but toast should still be removed
    expect(error).not.toBeNull()
    expect(error.message).toBe("Network error")
    expect(removeTaskCalls.length).toBe(1)
    expect(removeTaskCalls[0]).toBe("resume_sync_ses_test")
  })

  test("removes toast when pollSyncSession throws", async () => {
    //#given - mock pollSyncSession to throw an error
    mock.module("./sync-session-poller.ts", () => ({
      pollSyncSession: async () => {
        throw new Error("Poll error")
      },
    }))

    const mockClient = {
      session: {
        messages: async () => ({
          data: [
            { info: { id: "msg_001", role: "user", time: { created: 1000 } } },
            {
              info: { id: "msg_002", role: "assistant", time: { created: 2000 }, finish: "end_turn" },
              parts: [{ type: "text", text: "Response" }],
            },
          ],
        }),
        promptAsync: async () => ({}),
        status: async () => ({
          data: { ses_test: { type: "idle" } },
        }),
      },
    }

    const { executeSyncContinuation } = require("./sync-continuation")

    const mockCtx = {
      sessionID: "parent-session",
      callID: "call-123",
      metadata: () => {},
    }

    const mockExecutorCtx = {
      client: mockClient,
    }

    const args = {
      session_id: "ses_test_12345678",
      prompt: "test prompt",
      description: "test task",
      load_skills: [],
      run_in_background: false,
    }

    //#when - executeSyncContinuation with pollSyncSession throwing
    let error: any = null
    let result: string | null = null
    try {
      result = await executeSyncContinuation(args, mockCtx, mockExecutorCtx)
    } catch (e) {
      error = e
    }

    //#then - error should be thrown but toast should still be removed
    expect(error).not.toBeNull()
    expect(error.message).toBe("Poll error")
    expect(removeTaskCalls.length).toBe(1)
    expect(removeTaskCalls[0]).toBe("resume_sync_ses_test")
  })

  test("removes toast on successful completion", async () => {
    //#given - mock successful completion with messages growing after anchor
    const mockClient = {
      session: {
        messages: async () => ({
          data: [
            { info: { id: "msg_001", role: "user", time: { created: 1000 } } },
            {
              info: { id: "msg_002", role: "assistant", time: { created: 2000 }, finish: "end_turn" },
              parts: [{ type: "text", text: "Response" }],
            },
            { info: { id: "msg_003", role: "user", time: { created: 3000 } } },
            {
              info: { id: "msg_004", role: "assistant", time: { created: 4000 }, finish: "end_turn" },
              parts: [{ type: "text", text: "New response" }],
            },
          ],
        }),
        promptAsync: async () => ({}),
        status: async () => ({
          data: { ses_test: { type: "idle" } },
        }),
      },
    }

    const { executeSyncContinuation } = require("./sync-continuation")

    const mockCtx = {
      sessionID: "parent-session",
      callID: "call-123",
      metadata: () => {},
    }

    const mockExecutorCtx = {
      client: mockClient,
    }

    const args = {
      session_id: "ses_test_12345678",
      prompt: "test prompt",
      description: "test task",
      load_skills: [],
      run_in_background: false,
    }

    //#when - executeSyncContinuation completes successfully
    const result = await executeSyncContinuation(args, mockCtx, mockExecutorCtx)

    //#then - toast should be removed exactly once
    expect(removeTaskCalls.length).toBe(1)
    expect(removeTaskCalls[0]).toBe("resume_sync_ses_test")
    expect(result).toContain("Task continued and completed")
    expect(result).toContain("Result")
  })

  test("removes toast when abort happens", async () => {
    //#given - mock pollSyncSession to detect abort and remove toast
    mock.module("./sync-session-poller.ts", () => ({
      pollSyncSession: async (ctx: any, client: any, input: any) => {
        if (input.toastManager && input.taskId) {
          input.toastManager.removeTask(input.taskId)
        }
        return "Task aborted.\n\nSession ID: ses_test_12345678"
      },
    }))

    //#given - create a context with abort signal
    const controller = new AbortController()
    controller.abort()

    const mockClient = {
      session: {
        messages: async () => ({
          data: [
            { info: { id: "msg_001", role: "user", time: { created: 1000 } } },
            {
              info: { id: "msg_002", role: "assistant", time: { created: 2000 }, finish: "end_turn" },
              parts: [{ type: "text", text: "Response" }],
            },
          ],
        }),
        promptAsync: async () => ({}),
        status: async () => ({
          data: { ses_test: { type: "idle" } },
        }),
      },
    }

    const { executeSyncContinuation } = require("./sync-continuation")

    const mockCtx = {
      sessionID: "parent-session",
      callID: "call-123",
      metadata: () => {},
      abort: controller.signal,
    }

    const mockExecutorCtx = {
      client: mockClient,
    }

    const args = {
      session_id: "ses_test_12345678",
      prompt: "test prompt",
      description: "test task",
      load_skills: [],
      run_in_background: false,
    }

    //#when - executeSyncContinuation with abort signal
    const result = await executeSyncContinuation(args, mockCtx, mockExecutorCtx)

    //#then - removeTask should be called at least once (poller and finally may both call it)
    expect(removeTaskCalls.length).toBeGreaterThanOrEqual(1)
    expect(removeTaskCalls[0]).toBe("resume_sync_ses_test")
    expect(result).toContain("Task aborted")
  })

  test("no crash when toastManager is null", async () => {
		//#given - reset toast manager instance to null
    const { _resetTaskToastManagerForTesting } = require("../../features/task-toast-manager/manager")
    _resetTaskToastManagerForTesting()

    const mockClient = {
      session: {
        messages: async () => ({
          data: [
            { info: { id: "msg_001", role: "user", time: { created: 1000 } } },
            {
              info: { id: "msg_002", role: "assistant", time: { created: 2000 }, finish: "end_turn" },
              parts: [{ type: "text", text: "Response" }],
            },
          ],
        }),
        promptAsync: async () => ({}),
        status: async () => ({
          data: { ses_test: { type: "idle" } },
        }),
      },
    }

    const { executeSyncContinuation } = require("./sync-continuation")

    const mockCtx = {
      sessionID: "parent-session",
      callID: "call-123",
      metadata: () => {},
    }

    const mockExecutorCtx = {
      client: mockClient,
    }

    const args = {
      session_id: "ses_test_12345678",
      prompt: "test prompt",
      description: "test task",
      load_skills: [],
      run_in_background: false,
    }

    //#when - executeSyncContinuation with null toastManager
    let error: any = null
    let result: string | null = null
    try {
      result = await executeSyncContinuation(args, mockCtx, mockExecutorCtx)
    } catch (e) {
      error = e
    }

    //#then - should not crash and should complete successfully
    expect(error).toBeNull()
    expect(addTaskCalls.length).toBe(0)
    expect(removeTaskCalls.length).toBe(0)
  })
})
