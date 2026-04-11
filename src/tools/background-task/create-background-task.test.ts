/// <reference types="bun-types" />

import { describe, test, expect, mock } from "bun:test"
import type { BackgroundManager } from "../../features/background-agent"
import type { PluginInput } from "@opencode-ai/plugin"
import { createBackgroundTask } from "./create-background-task"

describe("createBackgroundTask", () => {
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

  const mockClient = {
    session: {
      messages: mock(() => Promise.resolve({ data: [] })),
    },
  } as unknown as PluginInput["client"]

  const tool = createBackgroundTask(mockManager, mockClient)

  const testContext = {
    sessionID: "test-session",
    messageID: "test-message",
    agent: "test-agent",
    directory: "/Users/yeongyu/local-workspaces/omo",
    worktree: "/Users/yeongyu/local-workspaces/omo",
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
  }

  const testArgs = {
    description: "Test background task",
    prompt: "Test prompt",
    agent: "test-agent",
  }

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
    const result = await tool.execute(testArgs, testContext)

    //#then
    expect(result).toContain("Task entered error state")
    expect(result).toContain("test-task-id")
  })

  test("keeps launched background task alive when parent aborts before session id resolves", async () => {
    //#given - background launch should survive parent abort during session-id wait
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
      return {
        id: "test-task-id",
        sessionID: null,
        description: "Test task",
        agent: "test-agent",
        status: "pending",
      }
    })

    //#when
    const result = await tool.execute(testArgs, {
      ...testContext,
      abort: abortController.signal,
    })

    //#then - tool should still report successful launch instead of cancelling child task
    expect(result).toContain("Background task launched successfully.")
    expect(result).toContain("Task ID: test-task-id")
    expect(result).not.toContain("Task aborted and cancelled while waiting for session to start")
  })

  test("keeps sibling background task alive when two tasks start concurrently", async () => {
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
      tool.execute(testArgs, {
        ...testContext,
        abort: firstAbortController.signal,
      }),
      tool.execute(testArgs, {
        ...testContext,
        abort: secondAbortController.signal,
      }),
    ])

    //#then - both launches still succeed and the sibling is not marked interrupted
    expect(firstResult).toContain("Background task launched successfully.")
    expect(secondResult).toContain("Background task launched successfully.")
    expect(secondResult).toContain("Task ID: task-2")
    expect(secondResult).not.toContain("interrupt")
  })
})
