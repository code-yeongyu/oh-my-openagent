const { describe, test, expect, mock } = require("bun:test")

describe("executeSync", () => {
  test("passes question=false via tools parameter to block question tool", async () => {
    //#given
    const { executeSync } = require("./sync-executor")

    const deps = {
      createOrGetSession: mock(async () => ({ sessionID: "ses-test-123", isNew: true })),
      waitForCompletion: mock(async () => {}),
      processMessages: mock(async () => "agent response"),
      setSessionFallbackChain: mock(() => {}),
    }

    let promptArgs: any
    const promptAsync = mock(async (input: any) => {
      promptArgs = input
      return { data: {} }
    })

    const args = {
      subagent_type: "explore",
      description: "test task",
      prompt: "find something",
    }

    const toolContext = {
      sessionID: "parent-session",
      messageID: "msg-1",
      agent: "sisyphus",
      abort: new AbortController().signal,
      metadata: mock(async () => {}),
    }

    const ctx = {
      client: {
        session: { promptAsync },
      },
    }

    //#when
    await executeSync(args, toolContext, ctx as any, deps)

    //#then
    expect(promptAsync).toHaveBeenCalled()
    expect(promptArgs.body.tools.question).toBe(false)
  })

  test("passes task=false via tools parameter", async () => {
    //#given
    const { executeSync } = require("./sync-executor")

    const deps = {
      createOrGetSession: mock(async () => ({ sessionID: "ses-test-123", isNew: true })),
      waitForCompletion: mock(async () => {}),
      processMessages: mock(async () => "agent response"),
      setSessionFallbackChain: mock(() => {}),
    }

    let promptArgs: any
    const promptAsync = mock(async (input: any) => {
      promptArgs = input
      return { data: {} }
    })

    const args = {
      subagent_type: "librarian",
      description: "search docs",
      prompt: "find docs",
    }

    const toolContext = {
      sessionID: "parent-session",
      messageID: "msg-2",
      agent: "sisyphus",
      abort: new AbortController().signal,
      metadata: mock(async () => {}),
    }

    const ctx = {
      client: {
        session: { promptAsync },
      },
    }

    //#when
    await executeSync(args, toolContext, ctx as any, deps)

    //#then
    expect(promptAsync).toHaveBeenCalled()
    expect(promptArgs.body.tools.task).toBe(false)
  })

  test("applies fallbackChain to sync sessions", async () => {
    //#given
    const { executeSync } = require("./sync-executor")

    const setSessionFallbackChain = mock(() => {})
    const deps = {
      createOrGetSession: mock(async () => ({ sessionID: "ses-test-456", isNew: true })),
      waitForCompletion: mock(async () => {}),
      processMessages: mock(async () => "agent response"),
      setSessionFallbackChain,
    }

    const args = {
      subagent_type: "explore",
      description: "test task",
      prompt: "find something",
    }

    const toolContext = {
      sessionID: "parent-session",
      messageID: "msg-3",
      agent: "sisyphus",
      abort: new AbortController().signal,
      metadata: mock(async () => {}),
    }

    const ctx = {
      client: {
        session: { promptAsync: mock(async () => ({ data: {} })) },
      },
    }

    const fallbackChain = [
      { providers: ["quotio"], model: "kimi-k2.5", variant: undefined },
      { providers: ["openai"], model: "gpt-5.2", variant: "high" },
    ]

    //#when
    await executeSync(args, toolContext, ctx as any, deps, fallbackChain)

    //#then
    expect(setSessionFallbackChain).toHaveBeenCalledWith("ses-test-456", fallbackChain)
  })
})
