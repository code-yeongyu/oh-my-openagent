/// <reference types="bun-types" />
import { describe, test, expect, mock } from "bun:test"
import type { BackgroundManager } from "../../features/background-agent"
import type { PluginInput } from "@opencode-ai/plugin"
import { executeBackgroundAgent } from "./background-agent-executor"

describe("executeBackgroundAgent", () => {
  const launchMock = mock(async (): Promise<{
    id: string
    sessionId: string | null
    description: string
    agent: string
    status: string
  }> => ({
    id: "test-task-id",
    sessionId: null,
    description: "Test task",
    agent: "explore",
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
    directory: "/Users/yeongyu/local-workspaces/omo",
    worktree: "/Users/yeongyu/local-workspaces/omo",
    abort: new AbortController().signal,
    metadata: () => {},
  } as unknown as Parameters<typeof executeBackgroundAgent>[1]

  const testArgs = {
    description: "Test background task",
    prompt: "Test prompt",
    subagent_type: "explore",
  } as Parameters<typeof executeBackgroundAgent>[0]

  const mockClient = {
    session: {
      messages: mock(() => Promise.resolve({ data: [] })),
    },
  } as unknown as PluginInput["client"]

  test("does not advertise background_output CTA in launch return (issue #5221)", async () => {
    //#given - a successful launch
    launchMock.mockResolvedValueOnce({
      id: "test-task-id",
      sessionId: "ses-agent-cta",
      description: "Test task",
      agent: "explore",
      status: "pending",
    })
    getTaskMock.mockReturnValueOnce({
      id: "test-task-id",
      sessionId: "ses-agent-cta",
      description: "Test task",
      agent: "explore",
      status: "pending",
    })

    //#when
    const result = await executeBackgroundAgent(testArgs, testContext, mockManager, mockClient)

    //#then - no polling CTA, anti-polling instruction preserved
    expect(result).not.toContain("Use `background_output` with task_id=")
    expect(result).not.toContain("to check.")
    expect(result).toContain("Do NOT call background_output now")
    expect(result).toContain("<system-reminder>")
  })

  test("#given missing caller identity #when legacy background execution runs #then it fails before launch", async () => {
    launchMock.mockClear()
    const missingCallerContext = {
      sessionID: testContext.sessionID,
      messageID: testContext.messageID,
      abort: testContext.abort,
      metadata: testContext.metadata,
    }

    const result = await executeBackgroundAgent(
      testArgs,
      missingCallerContext,
      mockManager,
      mockClient,
    )

    expect(result).toContain("trusted caller identity is required")
    expect(launchMock).not.toHaveBeenCalled()
  })
})
