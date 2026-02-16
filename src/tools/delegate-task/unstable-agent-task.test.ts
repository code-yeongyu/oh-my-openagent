const { describe, test, expect, beforeEach, afterEach, mock } = require("bun:test")

describe("executeUnstableAgentTask - interrupt detection", () => {
  beforeEach(() => {
    //#given - configure fast timing for all tests
    const { __setTimingConfig } = require("./timing")
    __setTimingConfig({
      POLL_INTERVAL_MS: 10,
      MIN_STABILITY_TIME_MS: 0,
      STABILITY_POLLS_REQUIRED: 1,
      MAX_POLL_TIME_MS: 500,
      WAIT_FOR_SESSION_TIMEOUT_MS: 100,
      WAIT_FOR_SESSION_INTERVAL_MS: 10,
    })
  })

  afterEach(() => {
    //#given - reset timing after each test
    const { __resetTimingConfig } = require("./timing")
    __resetTimingConfig()
    mock.restore()
  })

  test("should return error immediately when background task becomes interrupted during polling", async () => {
    //#given - a background task that gets interrupted on first poll check
    const taskState = {
      id: "bg_test_interrupt",
      sessionID: "ses_test_interrupt",
      status: "interrupt" as string,
      description: "test interrupted task",
      prompt: "test prompt",
      agent: "sisyphus-junior",
      error: "Agent not found" as string | undefined,
    }

    const launchState = { ...taskState, status: "running" as string, error: undefined as string | undefined }

    const mockManager = {
      launch: async () => launchState,
      getTask: () => taskState,
    }

    const mockClient = {
      session: {
        status: async () => ({ data: { [taskState.sessionID!]: { type: "idle" } } }),
        messages: async () => ({ data: [] }),
      },
    }

    const { executeUnstableAgentTask } = require("./unstable-agent-task")

    const args = {
      prompt: "test prompt",
      description: "test task",
      category: "test",
      load_skills: [],
      run_in_background: false,
    }

    const mockCtx = {
      sessionID: "parent-session",
      callID: "call-123",
      metadata: () => {},
    }

    const mockExecutorCtx = {
      manager: mockManager,
      client: mockClient,
      directory: "/tmp",
    }

    const parentContext = {
      sessionID: "parent-session",
      messageID: "msg-123",
    }

    //#when - executeUnstableAgentTask encounters an interrupted task
    const startTime = Date.now()
    const result = await executeUnstableAgentTask(
      args, mockCtx, mockExecutorCtx, parentContext,
      "test-agent", undefined, undefined, "test-model"
    )
    const elapsed = Date.now() - startTime

    //#then - should return quickly with interrupt error, not hang until MAX_POLL_TIME_MS
    expect(result).toContain("interrupt")
    expect(result.toLowerCase()).toContain("agent not found")
    expect(elapsed).toBeLessThan(400)
  })

  test("should return error immediately when background task becomes errored during polling", async () => {
    //#given - a background task that is already errored when poll checks
    const taskState = {
      id: "bg_test_error",
      sessionID: "ses_test_error",
      status: "error" as string,
      description: "test error task",
      prompt: "test prompt",
      agent: "sisyphus-junior",
      error: "Rate limit exceeded" as string | undefined,
    }

    const launchState = { ...taskState, status: "running" as string, error: undefined as string | undefined }

    const mockManager = {
      launch: async () => launchState,
      getTask: () => taskState,
    }

    const mockClient = {
      session: {
        status: async () => ({ data: { [taskState.sessionID!]: { type: "idle" } } }),
        messages: async () => ({ data: [] }),
      },
    }

    const { executeUnstableAgentTask } = require("./unstable-agent-task")

    const args = {
      prompt: "test prompt",
      description: "test task",
      category: "test",
      load_skills: [],
      run_in_background: false,
    }

    const mockCtx = {
      sessionID: "parent-session",
      callID: "call-123",
      metadata: () => {},
    }

    const mockExecutorCtx = {
      manager: mockManager,
      client: mockClient,
      directory: "/tmp",
    }

    const parentContext = {
      sessionID: "parent-session",
      messageID: "msg-123",
    }

    //#when - executeUnstableAgentTask encounters an errored task
    const startTime = Date.now()
    const result = await executeUnstableAgentTask(
      args, mockCtx, mockExecutorCtx, parentContext,
      "test-agent", undefined, undefined, "test-model"
    )
    const elapsed = Date.now() - startTime

    //#then - should return quickly with error, not hang until MAX_POLL_TIME_MS
    expect(result).toContain("error")
    expect(result.toLowerCase()).toContain("rate limit exceeded")
    expect(elapsed).toBeLessThan(400)
  })

  test("should return error immediately when background task becomes cancelled during polling", async () => {
    //#given - a background task that is already cancelled when poll checks
    const taskState = {
      id: "bg_test_cancel",
      sessionID: "ses_test_cancel",
      status: "cancelled" as string,
      description: "test cancelled task",
      prompt: "test prompt",
      agent: "sisyphus-junior",
      error: "Stale timeout" as string | undefined,
    }

    const launchState = { ...taskState, status: "running" as string, error: undefined as string | undefined }

    const mockManager = {
      launch: async () => launchState,
      getTask: () => taskState,
    }

    const mockClient = {
      session: {
        status: async () => ({ data: { [taskState.sessionID!]: { type: "idle" } } }),
        messages: async () => ({ data: [] }),
      },
    }

    const { executeUnstableAgentTask } = require("./unstable-agent-task")

    const args = {
      prompt: "test prompt",
      description: "test task",
      category: "test",
      load_skills: [],
      run_in_background: false,
    }

    const mockCtx = {
      sessionID: "parent-session",
      callID: "call-123",
      metadata: () => {},
    }

    const mockExecutorCtx = {
      manager: mockManager,
      client: mockClient,
      directory: "/tmp",
    }

    const parentContext = {
      sessionID: "parent-session",
      messageID: "msg-123",
    }

    //#when - executeUnstableAgentTask encounters a cancelled task
    const startTime = Date.now()
    const result = await executeUnstableAgentTask(
      args, mockCtx, mockExecutorCtx, parentContext,
      "test-agent", undefined, undefined, "test-model"
    )
    const elapsed = Date.now() - startTime

    //#then - should return quickly with cancel info, not hang until MAX_POLL_TIME_MS
    expect(result).toContain("cancel")
    expect(result.toLowerCase()).toContain("stale timeout")
    expect(elapsed).toBeLessThan(400)
  })
})
