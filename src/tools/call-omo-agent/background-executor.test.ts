import { describe, test, expect, mock } from "bun:test"
import type { BackgroundManager } from "../../features/background-agent"
import { executeBackground } from "./background-executor"

describe("executeBackground", () => {
  const mockManager = {
    launch: mock(() => Promise.resolve({
      id: "test-task-id",
      sessionID: null,
      description: "Test task",
      agent: "test-agent",
      status: "pending",
    })),
    getTask: mock(),
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
  }

  test("detects interrupted task as failure", async () => {
    //#given
    mockManager.launch.mockResolvedValueOnce({
      id: "test-task-id",
      sessionID: null,
      description: "Test task",
      agent: "test-agent",
      status: "pending",
    })
    mockManager.getTask.mockReturnValueOnce({
      id: "test-task-id",
      sessionID: null,
      description: "Test task",
      agent: "test-agent",
      status: "interrupt",
    })

    //#when
    const result = await executeBackground(testArgs, testContext, mockManager)

    //#then
    expect(result).toContain("Task failed to start")
    expect(result).toContain("interrupt")
    expect(result).toContain("test-task-id")
  })
})