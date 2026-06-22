/// <reference types="bun-types" />

import { describe, expect, mock, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import type { BackgroundManager } from "../../features/background-agent"
import { createBackgroundOutput } from "./create-background-output"

describe("createBackgroundOutput", () => {
  const getTaskMock = mock(() => ({
    id: "test-task-id",
    sessionID: undefined,
    description: "Test task",
    agent: "test-agent",
    status: "running",
  }))

  const mockManager = {
    getTask: getTaskMock,
  } as unknown as BackgroundManager

  const mockClient = {
    session: {
      messages: mock(() => Promise.resolve({ data: [] })),
    },
  } as unknown as PluginInput["client"]

  const tool = createBackgroundOutput(mockManager, mockClient)

  const testContext = {
    sessionID: "test-session",
    messageID: "test-message",
    agent: "test-agent",
    abort: new AbortController().signal,
  }

  const testArgs = {
    task_id: "test-task-id",
  }

  test("does not call ctx.metadata with literal 'pending' when sessionID is missing", async () => {
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
    expect(result).not.toContain("pending")
  })
})
