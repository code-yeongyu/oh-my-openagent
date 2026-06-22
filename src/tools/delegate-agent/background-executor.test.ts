/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import type { BackgroundManager } from "../../features/background-agent"
import { executeBackground } from "./background-executor"

describe("executeBackground", () => {
  const launchMock = mock(() => Promise.resolve({
    id: "test-task-id",
    sessionID: null,
    description: "Test task",
    agent: "test-agent",
    status: "running",
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
    const result = await executeBackground(testArgs, testContext, mockManager, mockClient)

    //#then
    expect(result).toContain("Task failed to start")
    expect(result).toContain("interrupt")
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
      }

      //#when
      const result = await executeBackground(testArgs, ctxWithMetadata, mockManager, mockClient)

      //#then - bug eliminated: formatDetailedError used, metadata untouched
      expect(metadataMock).not.toHaveBeenCalled()
      expect(result).toContain("failed")
      expect(result).toContain("test-task-id")
      expect(result).not.toContain("Background agent task launched successfully")
    })
  })
})
