/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import type { BackgroundManager } from "../../features/background-agent"
import { executeBackgroundTask } from "./background-task"
import { __resetTimingConfig, __setTimingConfig } from "./timing"

describe("executeBackgroundTask - pending placeholder regression", () => {
  beforeEach(() => {
    __setTimingConfig({
      WAIT_FOR_SESSION_TIMEOUT_MS: 50,
      WAIT_FOR_SESSION_INTERVAL_MS: 5,
    })
  })

  afterEach(() => {
    __resetTimingConfig()
  })

  test("does not call ctx.metadata with literal 'pending' when session times out", async () => {
    //#given - launch returns task with no sessionID and getTask also returns no sessionID
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

    const metadataMock = mock(() => {})
    const testContext = {
      sessionID: "test-session",
      messageID: "test-message",
      agent: "test-agent",
      abort: new AbortController().signal,
      metadata: metadataMock,
      callID: "test-call",
    }

    const testArgs = {
      description: "Test background task",
      prompt: "Test prompt",
      category: "test",
      subagent_type: "test-agent",
      run_in_background: true,
      load_skills: [],
    }

    const mockClient = {
      session: { messages: mock(() => Promise.resolve({ data: [] })) },
    } as unknown as PluginInput["client"]

    const executorCtx = {
      manager: mockManager,
      client: mockClient,
      directory: "/tmp",
    }
    const parentContext = {
      sessionID: "parent-session",
      messageID: "parent-message",
    }

    //#when
    const result = await executeBackgroundTask(
      // biome-ignore lint/suspicious/noExplicitAny: test requires minimal fixture typing
      testArgs as any,
      // biome-ignore lint/suspicious/noExplicitAny: test requires minimal fixture typing
      testContext as any,
      // biome-ignore lint/suspicious/noExplicitAny: test requires minimal fixture typing
      executorCtx as any,
      // biome-ignore lint/suspicious/noExplicitAny: test requires minimal fixture typing
      parentContext as any,
      "test-agent",
      undefined,
      undefined
    )

    //#then - bug eliminated: formatDetailedError used, success path skipped, metadata untouched
    expect(metadataMock).not.toHaveBeenCalled()
    expect(result).toContain("failed")
    expect(result).toContain("test-task-id")
    expect(result).not.toContain("Background task launched")
  })
})
