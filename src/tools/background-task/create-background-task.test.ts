/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import type { BackgroundManager } from "../../features/background-agent"
import { createBackgroundTask } from "./create-background-task"

describe("createBackgroundTask", () => {
  const launchMock = mock(() =>
    Promise.resolve({
      id: "test-task-id",
      sessionID: null,
      description: "Test task",
      agent: "test-agent",
      status: "running",
    })
  )
  const getTaskMock = mock(() => ({
    id: "test-task-id",
    sessionID: null,
    description: "Test task",
    agent: "test-agent",
    status: "running",
  }))

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
    abort: new AbortController().signal,
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
      status: "running",
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

  describe("pending placeholder regression", () => {
    let origDateNow: () => number
    let origSetTimeout: typeof setTimeout
    let mockTime: number

    beforeEach(() => {
      //#given - mock Date.now and setTimeout to bypass hardcoded 30s wait loop
      origDateNow = Date.now
      origSetTimeout = globalThis.setTimeout
      mockTime = 0
      Date.now = () => {
        mockTime += 31_000
        return mockTime
      }
      globalThis.setTimeout = ((cb: () => void) => {
        cb()
        return 0 as unknown as ReturnType<typeof setTimeout>
      }) as unknown as typeof setTimeout
    })

    afterEach(() => {
      Date.now = origDateNow
      globalThis.setTimeout = origSetTimeout
    })

    test("does not call ctx.metadata with literal 'pending' when session times out", async () => {
      //#given - ctx.metadata is a mock we can assert on
      const metadataMock = mock(() => {})
      const ctxWithMetadata = {
        ...testContext,
        metadata: metadataMock,
        callID: "test-call",
      }

      //#when
      const result = await tool.execute(testArgs, ctxWithMetadata)

      //#then - bug eliminated: formatDetailedError used, metadata untouched
      expect(metadataMock).not.toHaveBeenCalled()
      expect(result).toContain("failed")
      expect(result).toContain("test-task-id")
      expect(result).not.toContain("Background task launched successfully")
    })
  })
})
