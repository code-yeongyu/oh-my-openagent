/// <reference types="bun-types" />
import { describe, test, expect, mock } from "bun:test"
import type { BackgroundManager } from "../../features/background-agent"
import type { PluginInput } from "@opencode-ai/plugin"
import { executeBackgroundAgent } from "./background-agent-executor"

describe("executeBackgroundAgent", () => {
  const launchMock = mock(async (): Promise<{
    id: string
    sessionID: string | null
    description: string
    agent: string
    status: string
  }> => ({
    id: "test-task-id",
    sessionID: null,
    description: "Test task",
    agent: "test-agent",
    status: "pending",
  }))
  const getTaskMock = mock()

  const mockManager = {
    launch: launchMock,
    getTask: getTaskMock,
  } as unknown as BackgroundManager

  const testContext = {
    sessionID: "test-session",
    messageID: "test-message",
    agent: "test-agent",
    abort: new AbortController().signal,
  }

  const testArgs = {
    description: "Test background task",
    prompt: "Test prompt",
    subagent_type: "test-agent",
    run_in_background: true,
  }

  const mockClient = {
    session: {
      messages: mock(() => Promise.resolve({ data: [] })),
    },
  } as unknown as PluginInput["client"]

  test("detects interrupted task as failure", async () => {
    //#given
    launchMock.mockResolvedValueOnce({
      id: "test-task-id",
      sessionID: null,
      description: "Test task",
      agent: "test-agent",
      status: "pending",
    })
    getTaskMock.mockReturnValueOnce({
      id: "test-task-id",
      sessionID: null,
      description: "Test task",
      agent: "test-agent",
      status: "interrupt",
    })

    //#when
    const result = await executeBackgroundAgent(testArgs, testContext, mockManager, mockClient)

    //#then
    expect(result).toContain("Task failed to start")
    expect(result).toContain("interrupt")
    expect(result).toContain("test-task-id")
  })

  test("keeps launched background task alive when parent aborts before session id resolves", async () => {
    //#given - parent abort after launch should stop waiting, not fail the background task
    const abortController = new AbortController()
    launchMock.mockResolvedValueOnce({
      id: "test-task-id",
      sessionID: null,
      description: "Test task",
      agent: "test-agent",
      status: "pending",
    })
    getTaskMock.mockImplementationOnce(() => {
      abortController.abort()
      return { id: "test-task-id", sessionID: null, description: "Test task", agent: "test-agent", status: "pending" }
    })

    //#when
    const result = await executeBackgroundAgent(
      testArgs,
      {
        ...testContext,
        abort: abortController.signal,
      },
      mockManager,
      mockClient
    )

    //#then - background launch should still be reported as launched
    expect(result).toContain("Background agent task launched successfully")
    expect(result).toContain("Task ID: test-task-id")
    expect(result).not.toContain("Task aborted while waiting for session to start")
  })

  test("keeps sibling background agent launch alive when two tasks start concurrently", async () => {
    //#given - one aborted parent call should not interrupt a sibling launch from the same parent session
    const firstAbortController = new AbortController()
    const secondAbortController = new AbortController()
    const states = new Map([
      ["task-1", { reads: 0, abortOnFirstRead: true, sessionID: "ses-1" }],
      ["task-2", { reads: 0, abortOnFirstRead: false, sessionID: "ses-2" }],
    ])
    let launchCount = 0
    launchMock.mockImplementation(async () => {
      launchCount += 1
      return launchCount === 1
        ? { id: "task-1", sessionID: null, description: "Task 1", agent: "test-agent", status: "pending" }
        : { id: "task-2", sessionID: null, description: "Task 2", agent: "test-agent", status: "pending" }
    })
    getTaskMock.mockImplementation((taskID: string) => {
      const state = states.get(taskID)
      if (!state) return undefined
      state.reads += 1
      if (state.abortOnFirstRead && state.reads === 1) {
        firstAbortController.abort()
      }
      return state.reads >= 2
        ? { id: taskID, sessionID: state.sessionID, description: "Task", agent: "test-agent", status: "pending" }
        : { id: taskID, sessionID: null, description: "Task", agent: "test-agent", status: "pending" }
    })

    //#when
    const [firstResult, secondResult] = await Promise.all([
      executeBackgroundAgent(
        testArgs,
        { ...testContext, abort: firstAbortController.signal },
        mockManager,
        mockClient,
      ),
      executeBackgroundAgent(
        testArgs,
        { ...testContext, abort: secondAbortController.signal },
        mockManager,
        mockClient,
      ),
    ])

    //#then - both launches still succeed and the sibling is not marked interrupted
    expect(firstResult).toContain("Background agent task launched successfully")
    expect(secondResult).toContain("Background agent task launched successfully")
    expect(secondResult).toContain("Task ID: task-2")
    expect(secondResult).not.toContain("interrupt")
  })
})
