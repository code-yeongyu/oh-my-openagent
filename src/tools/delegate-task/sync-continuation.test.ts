declare const require: (name: string) => any
const { describe, test, expect, beforeEach, afterEach, mock } = require("bun:test")

describe("executeSyncContinuation - toast cleanup error paths", () => {
  let removeTaskCalls: string[] = []
  let addTaskCalls: any[] = []

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

    //#given - mock task-toast-manager module
    const mockToastManager = {
      addTask: (task: any) => { addTaskCalls.push(task) },
      removeTask: (id: string) => { removeTaskCalls.push(id) },
    }

    const mockGetTaskToastManager = () => mockToastManager

    mock.module("../../features/task-toast-manager/index.ts", () => ({
      getTaskToastManager: mockGetTaskToastManager,
      TaskToastManager: class {},
      initTaskToastManager: () => mockToastManager,
    }))
  })

  afterEach(() => {
    //#given - reset timing after each test
    const { __resetTimingConfig } = require("./timing")
    __resetTimingConfig()

    mock.restore()
  })

  test("removes toast when fetchSyncResult throws an exception", async () => {
    //#given - mock dependencies where messages return error state
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

    //#when - executeSyncContinuation completes
    const result = await executeSyncContinuation(args, mockCtx, mockExecutorCtx)

    //#then - removeTask should have been called exactly once
    expect(removeTaskCalls.length).toBe(1)
    expect(removeTaskCalls[0]).toBe("resume_sync_ses_test")
  })

  test("removes toast when pollSyncSession throws an exception", async () => {
    //#given - mock client with completion issues
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

    //#when - executeSyncContinuation
    const result = await executeSyncContinuation(args, mockCtx, mockExecutorCtx)

    //#then - removeTask should have been called exactly once
    expect(removeTaskCalls.length).toBe(1)
    expect(removeTaskCalls[0]).toBe("resume_sync_ses_test")
  })

  test("removes toast on successful completion", async () => {
    //#given - mock dependencies where everything succeeds with new assistant message
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

    //#when - executeSyncContinuation successfully
    const result = await executeSyncContinuation(args, mockCtx, mockExecutorCtx)

    //#then - removeTask should have been called exactly once
    expect(removeTaskCalls.length).toBe(1)
    expect(removeTaskCalls[0]).toBe("resume_sync_ses_test")
    expect(result).toContain("Session completed but no new response was generated")
  })

  test("removes toast when poll returns abort error", async () => {
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

    //#then - removeTask should have been called twice (once in catch, once in finally)
    expect(removeTaskCalls.length).toBe(2)
    expect(result).toContain("Task aborted")
  })

  test("does not add toast when toastManager is null (no crash)", async () => {
    //#given - mock task-toast-manager module to return null
    const mockGetTaskToastManager = () => null

    mock.module("../../features/task-toast-manager/index.ts", () => ({
      getTaskToastManager: mockGetTaskToastManager,
      TaskToastManager: class {},
      initTaskToastManager: () => null,
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
