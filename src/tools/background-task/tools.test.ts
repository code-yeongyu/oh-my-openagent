/// <reference types="bun-types" />

import { describe, test, expect } from "bun:test"
import { createBackgroundCancel, createBackgroundOutput } from "./tools"
import type { BackgroundManager, BackgroundTask } from "../../features/background-agent"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import type { BackgroundCancelClient, BackgroundOutputManager, BackgroundOutputClient } from "./tools"
import { consumeToolMetadata, clearPendingStore } from "../../features/tool-metadata-store"

const projectDir = "/Users/yeongyu/local-workspaces/oh-my-opencode"

const mockContext: ToolContext = {
  sessionID: "test-session",
  messageID: "test-message",
  agent: "test-agent",
  directory: projectDir,
  worktree: projectDir,
  abort: new AbortController().signal,
  metadata: () => {},
  ask: async () => {},
}

function createMockManager(task: BackgroundTask): BackgroundOutputManager {
  return {
    getTask: (id: string) => (id === task.id ? task : undefined),
  }
}

function createMockClient(messagesBySession: Record<string, BackgroundOutputMessage[]>): BackgroundOutputClient {
  const emptyMessages: BackgroundOutputMessage[] = []
  const client = {
    session: {
      messages: async ({ path }: { path: { id: string } }) => ({
        data: messagesBySession[path.id] ?? emptyMessages,
      }),
    },
  } satisfies BackgroundOutputClient
  return client
}

function createTask(overrides: Partial<BackgroundTask> = {}): BackgroundTask {
  return {
    id: "task-1",
    sessionID: "ses-1",
    parentSessionID: "main-1",
    parentMessageID: "msg-1",
    description: "background task",
    prompt: "do work",
    agent: "test-agent",
    status: "running",
    ...overrides,
  }
}

describe("background_output full_session", () => {
  test("resolves task_id into title metadata", async () => {
    // #given
    clearPendingStore()

    const task = createTask({
      id: "task-1",
      agent: "explore",
      description: "Find how task output is rendered",
      status: "running",
    })
    const manager = createMockManager(task)
    const client = createMockClient({})
    const tool = createBackgroundOutput(manager, client)
    const ctxWithCallId = {
      ...mockContext,
      callID: "call-1",
    } as unknown as ToolContext

    // #when
    await tool.execute({ task_id: "task-1" }, ctxWithCallId)

    // #then
    const restored = consumeToolMetadata("test-session", "call-1")
    expect(restored?.title).toBe("explore - Find how task output is rendered")
  })

  test("shows category instead of agent for sisyphus-junior", async () => {
    // #given
    clearPendingStore()

    const task = createTask({
      id: "task-1",
      agent: "sisyphus-junior",
      category: "quick",
      description: "Fix flaky test",
      status: "running",
    })
    const manager = createMockManager(task)
    const client = createMockClient({})
    const tool = createBackgroundOutput(manager, client)
    const ctxWithCallId = {
      ...mockContext,
      callID: "call-1",
    } as unknown as ToolContext

    // #when
    await tool.execute({ task_id: "task-1" }, ctxWithCallId)

    // #then
    const restored = consumeToolMetadata("test-session", "call-1")
    expect(restored?.title).toBe("quick - Fix flaky test")
  })

  test("includes thinking and tool results when enabled", async () => {
    // #given
    const task = createTask()
    const manager = createMockManager(task)
    const client = createMockClient({
      "ses-1": [
        {
          id: "m1",
          info: { role: "assistant", time: "2026-01-01T00:00:00Z", agent: "test" },
          parts: [
            { type: "text", text: "hello" },
            { type: "thinking", thinking: "thinking text" },
            { type: "tool_result", content: "tool output" },
          ],
        },
        {
          id: "m2",
          info: { role: "assistant", time: "2026-01-01T00:00:01Z" },
          parts: [
            { type: "reasoning", text: "reasoning text" },
            { type: "text", text: "after" },
          ],
        },
      ],
    })
    const tool = createBackgroundOutput(manager, client)

    // #when
    const output = await tool.execute({
      task_id: "task-1",
      full_session: true,
      include_thinking: true,
      include_tool_results: true,
    }, mockContext)

    // #then
    expect(output).toContain("thinking text")
    expect(output).toContain("reasoning text")
    expect(output).toContain("tool output")
  })

  test("respects since_message_id exclusive filtering", async () => {
    // #given
    const task = createTask()
    const manager = createMockManager(task)
    const client = createMockClient({
      "ses-1": [
        {
          id: "m1",
          info: { role: "assistant", time: "2026-01-01T00:00:00Z" },
          parts: [{ type: "text", text: "hello" }],
        },
        {
          id: "m2",
          info: { role: "assistant", time: "2026-01-01T00:00:01Z" },
          parts: [{ type: "text", text: "after" }],
        },
      ],
    })
    const tool = createBackgroundOutput(manager, client)

    // #when
    const output = await tool.execute({
      task_id: "task-1",
      full_session: true,
      since_message_id: "m1",
    }, mockContext)

    // #then
    expect(output.includes("hello")).toBe(false)
    expect(output).toContain("after")
  })

  test("returns error when since_message_id not found", async () => {
    // #given
    const task = createTask()
    const manager = createMockManager(task)
    const client = createMockClient({
      "ses-1": [
        {
          id: "m1",
          info: { role: "assistant", time: "2026-01-01T00:00:00Z" },
          parts: [{ type: "text", text: "hello" }],
        },
      ],
    })
    const tool = createBackgroundOutput(manager, client)

    // #when
    const output = await tool.execute({
      task_id: "task-1",
      full_session: true,
      since_message_id: "missing",
    }, mockContext)

    // #then
    expect(output).toContain("since_message_id not found")
  })

  test("caps message_limit at 100", async () => {
    // #given
    const task = createTask()
    const manager = createMockManager(task)
    const messages = Array.from({ length: 120 }, (_, index) => ({
      id: `m${index}`,
      info: {
        role: "assistant",
        time: new Date(2026, 0, 1, 0, 0, index).toISOString(),
      },
      parts: [{ type: "text", text: `message-${index}` }],
    }))
    const client = createMockClient({ "ses-1": messages })
    const tool = createBackgroundOutput(manager, client)

    // #when
    const output = await tool.execute({
      task_id: "task-1",
      full_session: true,
      message_limit: 200,
    }, mockContext)

    // #then
    expect(output).toContain("Returned: 100")
    expect(output).toContain("Has more: true")
  })

  test("keeps legacy status output when full_session is false", async () => {
    // #given
    const task = createTask({ status: "running" })
    const manager = createMockManager(task)
    const client = createMockClient({})
    const tool = createBackgroundOutput(manager, client)

    // #when
    const output = await tool.execute({ task_id: "task-1" }, mockContext)

    // #then
    expect(output).toContain("# Task Status")
    expect(output).toContain("Task ID")
  })

  test("truncates thinking content to thinking_max_chars", async () => {
    // #given
    const longThinking = "x".repeat(500)
    const task = createTask()
    const manager = createMockManager(task)
    const client = createMockClient({
      "ses-1": [
        {
          id: "m1",
          info: { role: "assistant", time: "2026-01-01T00:00:00Z" },
          parts: [
            { type: "thinking", thinking: longThinking },
            { type: "text", text: "hello" },
          ],
        },
      ],
    })
    const tool = createBackgroundOutput(manager, client)

    // #when
    const output = await tool.execute({
      task_id: "task-1",
      full_session: true,
      include_thinking: true,
      thinking_max_chars: 100,
    }, mockContext)

    // #then
    expect(output).toContain("[thinking] " + "x".repeat(100) + "...")
    expect(output).not.toContain("x".repeat(200))
  })

  test("uses default 2000 chars when thinking_max_chars not provided", async () => {
    // #given
    const longThinking = "y".repeat(2500)
    const task = createTask()
    const manager = createMockManager(task)
    const client = createMockClient({
      "ses-1": [
        {
          id: "m1",
          info: { role: "assistant", time: "2026-01-01T00:00:00Z" },
          parts: [
            { type: "thinking", thinking: longThinking },
            { type: "text", text: "hello" },
          ],
        },
      ],
    })
    const tool = createBackgroundOutput(manager, client)

    // #when
    const output = await tool.execute({
      task_id: "task-1",
      full_session: true,
      include_thinking: true,
    }, mockContext)

    // #then
    expect(output).toContain("[thinking] " + "y".repeat(2000) + "...")
    expect(output).not.toContain("y".repeat(2100))
  })
})

describe("background_cancel", () => {
  test("cancels a running task via manager", async () => {
    // #given
    const task = createTask({ status: "running" })
    const cancelled: string[] = []
    const manager = {
      getTask: (id: string) => (id === task.id ? task : undefined),
      getAllDescendantTasks: () => [task],
      cancelTask: async (taskId: string) => {
        cancelled.push(taskId)
        task.status = "cancelled"
        return true
      },
    } as unknown as BackgroundManager
    const client = { session: { abort: async () => ({}) } } as BackgroundCancelClient
    const tool = createBackgroundCancel(manager, client)

    // #when
    const output = await tool.execute({ taskId: task.id }, mockContext)

    // #then
    expect(cancelled).toEqual([task.id])
    expect(output).toContain("Task cancelled successfully")
  })

  test("cancels all running or pending tasks", async () => {
    // #given
    const taskA = createTask({ id: "task-a", status: "running" })
    const taskB = createTask({ id: "task-b", status: "pending" })
    const cancelled: string[] = []
    const manager = {
      getTask: () => undefined,
      getAllDescendantTasks: () => [taskA, taskB],
      cancelTask: async (taskId: string) => {
        cancelled.push(taskId)
        const task = taskId === taskA.id ? taskA : taskB
        task.status = "cancelled"
        return true
      },
    } as unknown as BackgroundManager
    const client = { session: { abort: async () => ({}) } } as BackgroundCancelClient
    const tool = createBackgroundCancel(manager, client)

    // #when
    const output = await tool.execute({ all: true }, mockContext)

    // #then
    expect(cancelled).toEqual([taskA.id, taskB.id])
    expect(output).toContain("Cancelled 2 background task(s)")
  })

  test("preserves original status in cancellation table", async () => {
    // #given
    const taskA = createTask({ id: "task-a", status: "running", sessionID: "ses-a", description: "running task" })
    const taskB = createTask({ id: "task-b", status: "pending", sessionID: undefined, description: "pending task" })
    const manager = {
      getTask: () => undefined,
      getAllDescendantTasks: () => [taskA, taskB],
      cancelTask: async (taskId: string) => {
        const task = taskId === taskA.id ? taskA : taskB
        task.status = "cancelled"
        return true
      },
    } as unknown as BackgroundManager
    const client = { session: { abort: async () => ({}) } } as BackgroundCancelClient
    const tool = createBackgroundCancel(manager, client)

    // #when
    const output = await tool.execute({ all: true }, mockContext)

    // #then
    expect(output).toContain("| `task-a` | running task | running | `ses-a` |")
    expect(output).toContain("| `task-b` | pending task | pending | (not started) |")
  })

  test("passes skipNotification: true to cancelTask to prevent deadlock", async () => {
    // #given
    const task = createTask({ id: "task-1", status: "running" })
    const cancelOptions: Array<{ taskId: string; options: unknown }> = []
    const manager = {
      getTask: (id: string) => (id === task.id ? task : undefined),
      getAllDescendantTasks: () => [task],
      cancelTask: async (taskId: string, options?: unknown) => {
        cancelOptions.push({ taskId, options })
        task.status = "cancelled"
        return true
      },
    } as unknown as BackgroundManager
    const client = { session: { abort: async () => ({}) } } as BackgroundCancelClient
    const tool = createBackgroundCancel(manager, client)

    // #when - cancel all tasks
    await tool.execute({ all: true }, mockContext)

    // #then - skipNotification should be true to prevent self-deadlock
    expect(cancelOptions).toHaveLength(1)
    expect(cancelOptions[0].options).toEqual(
      expect.objectContaining({ skipNotification: true })
    )
  })

  test("passes skipNotification: true when cancelling single task", async () => {
    // #given
    const task = createTask({ id: "task-1", status: "running" })
    const cancelOptions: Array<{ taskId: string; options: unknown }> = []
    const manager = {
      getTask: (id: string) => (id === task.id ? task : undefined),
      getAllDescendantTasks: () => [task],
      cancelTask: async (taskId: string, options?: unknown) => {
        cancelOptions.push({ taskId, options })
        task.status = "cancelled"
        return true
      },
    } as unknown as BackgroundManager
    const client = { session: { abort: async () => ({}) } } as BackgroundCancelClient
    const tool = createBackgroundCancel(manager, client)

    // #when - cancel single task
    await tool.execute({ taskId: task.id }, mockContext)

    // #then - skipNotification should be true
    expect(cancelOptions).toHaveLength(1)
    expect(cancelOptions[0].options).toEqual(
      expect.objectContaining({ skipNotification: true })
    )
  })
})
type BackgroundOutputMessage = {
  id?: string
  info?: { role?: string; time?: string | { created?: number }; agent?: string }
  parts?: Array<{
    type?: string
    text?: string
    thinking?: string
    content?: string | Array<{ type: string; text?: string }>
  }>
}
