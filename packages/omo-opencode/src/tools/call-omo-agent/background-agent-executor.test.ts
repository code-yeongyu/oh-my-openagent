/// <reference types="bun-types" />
import { describe, test, expect, mock } from "bun:test"
import type { BackgroundManager } from "../../features/background-agent"
import type { PluginInput } from "@opencode-ai/plugin"
import { executeBackgroundAgent } from "./background-agent-executor"

describe("executeBackgroundAgent", () => {
  const launchMock = mock(async (input?: { agent?: string }): Promise<{
    id: string
    sessionId: string | null
    description: string
    agent: string
    status: string
  }> => ({
    id: "test-task-id",
    sessionId: null,
    description: "Test task",
    agent: input?.agent ?? "explore",
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

  test("passes normalized agent display name to manager.launch", async () => {
    //#given - a subagent_type with a known display name
    const argsWithKnownAgent = {
      description: "Test background task",
      prompt: "Test prompt",
      subagent_type: "explore",
    } as Parameters<typeof executeBackgroundAgent>[0]

    launchMock.mockResolvedValueOnce({
      id: "test-task-id",
      sessionId: "ses-known-agent",
      description: "Test task",
      agent: "explore",
      status: "pending",
    })
    getTaskMock.mockReturnValueOnce({
      id: "test-task-id",
      sessionId: "ses-known-agent",
      description: "Test task",
      agent: "explore",
      status: "pending",
    })

    //#when
    await executeBackgroundAgent(argsWithKnownAgent, testContext, mockManager, mockClient)

    //#then - launch was called with the display name from AGENT_DISPLAY_NAMES, not the raw subagent_type with sort prefix
    const launchCall = launchMock.mock.calls[0]
    expect(launchCall?.[0]).toMatchObject({
      agent: "explore",
    })
  })
})
