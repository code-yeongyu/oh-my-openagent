const { describe, test, expect, mock } = require("bun:test")

describe("executeBackgroundContinuation - subagent metadata", () => {
  test("reports an error instead of false success when the task is already running", async () => {
    //#given - manager rejects a continuation that cannot be delivered
    const mockManager = {
      resume: async () => {
        throw new Error(
          "Task bg_running is currently running and cannot accept a continuation prompt. " +
          "Wait for it to complete before resuming it with task_id.",
        )
      },
    }

    const mockCtx = {
      sessionID: "parent-session",
      callID: "call-running",
      metadata: mock(() => Promise.resolve()),
    }

    const args = {
      task_id: "ses_running_123",
      prompt: "apply updated instructions",
      description: "update running task",
      load_skills: [],
      run_in_background: true,
    }

    //#when
    const { executeBackgroundContinuation } = require("./background-continuation")
    const result = await executeBackgroundContinuation(
      args,
      mockCtx,
      { manager: mockManager },
      {
        sessionID: "parent-session",
        messageID: "msg-parent",
        agent: "sisyphus",
      },
    )

    //#then - the tool cannot claim a continuation that was never delivered
    expect(result).toContain("currently running and cannot accept a continuation prompt")
    expect(result).not.toContain("Background task continued")
  })

  test("includes subagent in task_metadata when task has agent", async () => {
    //#given - mock manager.resume returning task with agent info
    const mockManager = {
      resume: async () => ({
        id: "bg_task_001",
        description: "oracle consultation",
        agent: "oracle",
        status: "running",
        sessionId: "ses_resumed_123",
      }),
    }

    const mockCtx = {
      sessionID: "parent-session",
      callID: "call-456",
      metadata: mock(() => Promise.resolve()),
    }

    const mockExecutorCtx = {
      manager: mockManager,
    }

    const parentContext = {
      sessionID: "parent-session",
      messageID: "msg-parent",
      agent: "sisyphus",
    }

    const args = {
      task_id: "ses_resumed_123",
      prompt: "continue working",
      description: "resume oracle",
      load_skills: [],
      run_in_background: true,
    }

    //#when - executeBackgroundContinuation completes
    const { executeBackgroundContinuation } = require("./background-continuation")
    const result = await executeBackgroundContinuation(args, mockCtx, mockExecutorCtx, parentContext)

    //#then - task_metadata should contain subagent field
    expect(result).toContain("<task_metadata>")
    expect(result).toContain("subagent: oracle")
    expect(result).toContain("session_id: ses_resumed_123")
    expect(result).toContain("background_task_id: bg_task_001")
    expect(result).not.toContain("task_id: ses_resumed_123")
    expect(result).toContain("Background Task ID: bg_task_001")
  })

  test("omits subagent from task_metadata when task agent is undefined", async () => {
    //#given - mock manager.resume returning task without agent
    const mockManager = {
      resume: async () => ({
        id: "bg_task_002",
        description: "unknown task",
        agent: undefined,
        status: "running",
        sessionId: "ses_resumed_456",
      }),
    }

    const mockCtx = {
      sessionID: "parent-session",
      callID: "call-789",
      metadata: mock(() => Promise.resolve()),
    }

    const mockExecutorCtx = {
      manager: mockManager,
    }

    const parentContext = {
      sessionID: "parent-session",
      messageID: "msg-parent",
      agent: "sisyphus",
    }

    const args = {
      task_id: "ses_resumed_456",
      prompt: "continue",
      description: "resume task",
      load_skills: [],
      run_in_background: true,
    }

    //#when - executeBackgroundContinuation completes without agent
    const { executeBackgroundContinuation } = require("./background-continuation")
    const result = await executeBackgroundContinuation(args, mockCtx, mockExecutorCtx, parentContext)

    //#then - task_metadata should NOT contain subagent field
    expect(result).toContain("<task_metadata>")
    expect(result).toContain("session_id: ses_resumed_456")
    expect(result).not.toContain("subagent:")
  })

  test("does not advertise background_output CTA in continuation return (issue #5221)", async () => {
    //#given - mock manager.resume
    const mockManager = {
      resume: async () => ({
        id: "bg_task_cta",
        description: "continue task",
        agent: "oracle",
        status: "running",
        sessionId: "ses_resumed_cta",
      }),
    }

    const mockCtx = {
      sessionID: "parent-session",
      callID: "call-cta",
      metadata: mock(() => Promise.resolve()),
    }

    const mockExecutorCtx = {
      manager: mockManager,
    }

    const parentContext = {
      sessionID: "parent-session",
      messageID: "msg-parent",
      agent: "sisyphus",
    }

    const args = {
      task_id: "ses_resumed_cta",
      prompt: "continue",
      description: "resume task",
      load_skills: [],
      run_in_background: true,
    }

    //#when
    const { executeBackgroundContinuation } = require("./background-continuation")
    const result = await executeBackgroundContinuation(args, mockCtx, mockExecutorCtx, parentContext)

    //#then - no polling CTA, anti-polling instruction preserved
    expect(result).not.toContain("Use `background_output` with task_id=")
    expect(result).not.toContain("to check.")
    expect(result).toContain("Do NOT call background_output now")
    expect(result).toContain("<system-reminder>")
  })

  test("directs blocking-mode continuations to wait-for-background-tasks", async () => {
    //#given
    const mockManager = {
      resume: async () => ({
        id: "bg_task_blocking",
        description: "continue task",
        agent: "oracle",
        status: "running",
        sessionId: "ses_resumed_blocking",
      }),
    }
    const mockCtx = {
      sessionID: "parent-session",
      callID: "call-blocking",
      metadata: mock(() => Promise.resolve()),
    }
    const args = {
      task_id: "ses_resumed_blocking",
      prompt: "continue",
      description: "resume task",
      load_skills: [],
      run_in_background: true,
    }

    //#when
    const { executeBackgroundContinuation } = require("./background-continuation")
    const result = await executeBackgroundContinuation(
      args,
      mockCtx,
      {
        manager: mockManager,
        isBackgroundWaitAvailable: (sessionID) => {
          expect(sessionID).toBe("parent-session")
          return true
        },
      },
      { sessionID: "parent-session", messageID: "msg-parent", agent: "sisyphus" },
    )

    //#then
    expect(result).toContain("call `wait-for-background-tasks`")
    expect(result).not.toContain("Wait for <system-reminder>")
  })
})
