/// <reference types="bun-types" />

import { describe, test, expect, mock, beforeEach } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import { createBackgroundOutput } from "./create-background-output"
import type { BackgroundOutputClient, BackgroundOutputManager } from "./clients"

// Mock manager that always returns null (task not found)
const mockGetTask = mock(() => undefined)
const mockManager: BackgroundOutputManager = {
  getTask: mockGetTask,
}

// Mock client
const mockClient: BackgroundOutputClient = {
  session: {
    messages: async () => ({ data: [] }),
  },
}

const mockContext = {
  sessionID: "test-session",
  messageID: "test-message",
  agent: "test-agent",
  directory: "/test/project",
  worktree: "/test/project",
  abort: new AbortController().signal,
  metadata: () => {},
  ask: async () => {},
} as ToolContext

describe("background_output type-aware errors", () => {
  beforeEach(() => {
    mockGetTask.mockReturnValue(undefined)
  })

  test("returns session hint for ses_ prefix", async () => {
    const tool = createBackgroundOutput(mockManager, mockClient)
    const result = await tool.execute(
      { task_id: "ses_abc123" },
      mockContext
    )
    expect(result).toContain("session id")
    expect(result).toContain("session_read")
  })

  test("returns task hint for T- prefix", async () => {
    const tool = createBackgroundOutput(mockManager, mockClient)
    const result = await tool.execute(
      { task_id: "T-abc123-def456" },
      mockContext
    )
    expect(result).toContain("plan task id")
    expect(result).toContain("bg_")
  })

  test("returns generic not found for bg_ prefix", async () => {
    const tool = createBackgroundOutput(mockManager, mockClient)
    const result = await tool.execute(
      { task_id: "bg_notexist1" },
      mockContext
    )
    expect(result).toContain("Task not found: bg_notexist1")
  })

  test("returns generic not found for unknown prefix", async () => {
    const tool = createBackgroundOutput(mockManager, mockClient)
    const result = await tool.execute(
      { task_id: "garbage_id" },
      mockContext
    )
    expect(result).toContain("Task not found: garbage_id")
  })
})
