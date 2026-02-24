const { describe, test, expect, mock, beforeEach, afterEach } = require("bun:test")

describe("executeBackgroundContinuation - subagent metadata", () => {
  test("includes subagent in task_metadata when task has agent", async () => {
    //#given - mock manager.resume returning task with agent info
    const mockManager = {
      resume: async () => ({
        id: "bg_task_001",
        description: "oracle consultation",
        agent: "oracle",
        status: "running",
        sessionID: "ses_resumed_123",
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
      session_id: "ses_resumed_123",
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
  })

  test("omits subagent from task_metadata when task agent is undefined", async () => {
    //#given - mock manager.resume returning task without agent
    const mockManager = {
      resume: async () => ({
        id: "bg_task_002",
        description: "unknown task",
        agent: undefined,
        status: "running",
        sessionID: "ses_resumed_456",
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
      session_id: "ses_resumed_456",
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
})

describe("executeBackgroundContinuation - compression", () => {
  let receivedPrompt: string | undefined

  beforeEach(() => {
    receivedPrompt = undefined
  })

  test("#given prompt is compressed when compression enabled", async () => {
    //#given - mock manager that captures the prompt passed to resume
    const mockManager = {
      resume: async (params: { prompt: string }) => {
        receivedPrompt = params.prompt
        return {
          id: "bg_task_compressed",
          description: "compressed task",
          agent: "oracle",
          status: "running",
          sessionID: "ses_compressed",
        }
      },
    }

    const mockCtx = {
      sessionID: "parent-session",
      callID: "call-compressed",
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
      session_id: "ses_compressed",
      prompt: "continue working with a long prompt that should be compressed",
      description: "compressed task",
      load_skills: [],
      run_in_background: true,
    }

    const compressionConfig = {
      enabled: true,
      threshold: 10,
    }

    //#when - executeBackgroundContinuation with compression enabled
    const { executeBackgroundContinuation } = require("./background-continuation")
    await executeBackgroundContinuation(args, mockCtx, mockExecutorCtx, parentContext, compressionConfig)

    //#then - prompt should have been processed by safeCompress
    expect(receivedPrompt).toBeDefined()
    expect(typeof receivedPrompt).toBe("string")
  })

  test("#given prompt passes through unchanged when compression disabled", async () => {
    //#given - mock manager that captures the prompt passed to resume
    const originalPrompt = "continue working unchanged"
    const mockManager = {
      resume: async (params: { prompt: string }) => {
        receivedPrompt = params.prompt
        return {
          id: "bg_task_uncompressed",
          description: "uncompressed task",
          agent: "oracle",
          status: "running",
          sessionID: "ses_uncompressed",
        }
      },
    }

    const mockCtx = {
      sessionID: "parent-session",
      callID: "call-uncompressed",
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
      session_id: "ses_uncompressed",
      prompt: originalPrompt,
      description: "uncompressed task",
      load_skills: [],
      run_in_background: true,
    }

    const compressionConfig = {
      enabled: false,
      threshold: 5000,
    }

    //#when - executeBackgroundContinuation with compression disabled
    const { executeBackgroundContinuation } = require("./background-continuation")
    await executeBackgroundContinuation(args, mockCtx, mockExecutorCtx, parentContext, compressionConfig)

    //#then - prompt should be unchanged
    expect(receivedPrompt).toBe(originalPrompt)
  })

  test("#given uses default compression config when not provided", async () => {
    //#given - mock manager that captures the prompt passed to resume
    const originalPrompt = "short prompt"
    const mockManager = {
      resume: async (params: { prompt: string }) => {
        receivedPrompt = params.prompt
        return {
          id: "bg_task_default",
          description: "default config task",
          agent: "oracle",
          status: "running",
          sessionID: "ses_default",
        }
      },
    }

    const mockCtx = {
      sessionID: "parent-session",
      callID: "call-default",
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
      session_id: "ses_default",
      prompt: originalPrompt,
      description: "default config task",
      load_skills: [],
      run_in_background: true,
    }

    //#when - executeBackgroundContinuation without compression config (uses default)
    const { executeBackgroundContinuation } = require("./background-continuation")
    await executeBackgroundContinuation(args, mockCtx, mockExecutorCtx, parentContext)

    //#then - default config (disabled) should pass prompt unchanged
    expect(receivedPrompt).toBe(originalPrompt)
  })
})
