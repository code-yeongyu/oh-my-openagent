/// <reference types="bun-types" />

import { describe, test, expect, mock } from "bun:test"
import type { BackgroundManager } from "../../features/background-agent"
import type { PluginInput } from "@opencode-ai/plugin"
import { createBackgroundTask } from "./create-background-task"

describe("createBackgroundTask", () => {
  const launchMock = mock(() => Promise.resolve({
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
})
