/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import type { BackgroundTask } from "../../features/background-agent"
import type { BackgroundOutputClient, BackgroundOutputManager } from "./clients"
import { createBackgroundOutput } from "./create-background-output"

const projectDir = "/Users/yeongyu/local-workspaces/oh-my-opencode"

const mockContext = {
  sessionID: "test-session",
  messageID: "test-message",
  agent: "test-agent",
  directory: projectDir,
  worktree: projectDir,
  abort: new AbortController().signal,
  metadata: () => {},
  ask: async () => {},
} as ToolContext

function createTask(overrides: Partial<BackgroundTask> = {}): BackgroundTask {
  return {
    id: "bg_filters_task",
    sessionId: "ses-filters",
    parentSessionId: "main-1",
    parentMessageId: "msg-1",
    description: "background task",
    prompt: "do work",
    agent: "test-agent",
    status: "running",
    ...overrides,
  }
}

function createClientWithToolResult(): BackgroundOutputClient {
  return {
    session: {
      messages: async () => ({
        data: [
          {
            id: "m1",
            info: { role: "assistant", time: "2026-01-01T00:00:00Z" },
            parts: [{ type: "text", text: "assistant text" }],
          },
          {
            id: "m2",
            info: { role: "tool", time: "2026-01-01T00:00:01Z" },
            parts: [{ type: "tool_result", content: "SECRET_TOOL_OUTPUT" }],
          },
        ],
      }),
    },
  }
}

describe("createBackgroundOutput include_tool_results gating on a running task", () => {
  test("excludes tool_result blocks when include_tool_results is explicitly false", async () => {
    // #given a running task and a full_session request with include_tool_results:false
    const task = createTask()
    const manager: BackgroundOutputManager = {
      getTask: (id: string) => (id === task.id ? task : undefined),
    }
    const tool = createBackgroundOutput(manager, createClientWithToolResult())

    // #when
    const output = await tool.execute(
      { task_id: task.id, full_session: true, include_tool_results: false },
      mockContext
    )

    // #then explicit false is honored even though the task is active
    expect(output).toContain("# Full Session Output")
    expect(output).not.toContain("[tool result]")
    expect(output).not.toContain("SECRET_TOOL_OUTPUT")
  })

  test("includes tool_result blocks when include_tool_results is undefined (default-on while active)", async () => {
    // #given a running task and a full_session request without include_tool_results
    const task = createTask()
    const manager: BackgroundOutputManager = {
      getTask: (id: string) => (id === task.id ? task : undefined),
    }
    const tool = createBackgroundOutput(manager, createClientWithToolResult())

    // #when
    const output = await tool.execute({ task_id: task.id, full_session: true }, mockContext)

    // #then existing pollers keep tool results by default
    expect(output).toContain("[tool result]")
    expect(output).toContain("SECRET_TOOL_OUTPUT")
  })
})

describe("createBackgroundOutput completed-task branch passes from_end through", () => {
  test("formats a completed task result when from_end is true", async () => {
    // #given a completed task with assistant output
    const task = createTask({
      id: "bg_completed_from_end",
      sessionId: "ses-completed-from-end",
      status: "completed",
    })
    const manager: BackgroundOutputManager = {
      getTask: (id: string) => (id === task.id ? task : undefined),
    }
    const client: BackgroundOutputClient = {
      session: {
        messages: async () => ({
          data: [
            {
              id: "m1",
              info: { role: "assistant", time: "2026-01-01T00:00:00Z" },
              parts: [{ type: "text", text: "final answer text" }],
            },
          ],
        }),
      },
    }
    const tool = createBackgroundOutput(manager, client)

    // #when from_end is passed for a completed task
    const output = await tool.execute({ task_id: task.id, from_end: true }, mockContext)

    // #then the completed-task formatter runs and surfaces the final answer
    expect(output).toContain("Task Result")
    expect(output).toContain("Final answer")
    expect(output).toContain("final answer text")
  })
})
