/// <reference types="bun-types" />

import { describe, test, expect } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
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

async function withTempDataHome<T>(run: (dataHome: string) => Promise<T>): Promise<T> {
  const previous = process.env.XDG_DATA_HOME
  const dataHome = mkdtempSync(join(tmpdir(), "omo-bg-output-"))
  mkdirSync(join(dataHome, "opencode"), { recursive: true })

  process.env.XDG_DATA_HOME = dataHome

  try {
    return await run(dataHome)
  } finally {
    if (previous === undefined) {
      delete process.env.XDG_DATA_HOME
    } else {
      process.env.XDG_DATA_HOME = previous
    }
    rmSync(dataHome, { recursive: true, force: true })
  }
}

function createLaunchOnlyTaskDb(dataHome: string, options: {
  taskID: string
  sessionID: string
  parentSessionID: string
  parentMessageID: string
  description: string
  agent: string
  category?: string
  launchTime?: number
  includeStructuredTaskID?: boolean
}) {
  const db = new Database(join(dataHome, "opencode", "opencode.db"))
  db.exec(`
    CREATE TABLE part (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      data TEXT NOT NULL
    );
  `)

  const launchTime = options.launchTime ?? Date.now()
  const metadata = {
    agent: options.agent,
    category: options.category,
    description: options.description,
    run_in_background: true,
    sessionId: options.sessionID,
    ...(options.includeStructuredTaskID ? { taskId: options.taskID } : {}),
  }
  const data = {
    type: "tool",
    tool: "task",
    state: {
      status: "completed",
      input: {
        description: options.description,
        subagent_type: options.agent,
        run_in_background: true,
        ...(options.category ? { category: options.category } : {}),
      },
      output: `Background task launched.\n\nBackground Task ID: ${options.taskID}\nDescription: ${options.description}\nAgent: ${options.agent}${options.category ? ` (category: ${options.category})` : ""}\nStatus: pending\n\nSystem notifies on completion. Use \`background_output\` with task_id=\"${options.taskID}\" to check.\n\n<task_metadata>\nsession_id: ${options.sessionID}\ntask_id: ${options.taskID}\nbackground_task_id: ${options.taskID}\n</task_metadata>`,
      metadata,
      time: {
        start: launchTime,
        end: launchTime + 1,
      },
    },
  }

  db.query(`
    INSERT INTO part (id, session_id, message_id, time_created, data)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    `part-${options.taskID}`,
    options.parentSessionID,
    options.parentMessageID,
    launchTime,
    JSON.stringify(data),
  )

  db.close()
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
      agent: "Sisyphus-Junior",
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

  test("defaults to compact status when task is running", async () => {
    // #given
    const task = createTask({ status: "running" })
    const manager = createMockManager(task)
    const client = createMockClient({})
    const tool = createBackgroundOutput(manager, client)

    // #when
    const output = await tool.execute({ task_id: "task-1" }, mockContext)

    // #then
    expect(output).toContain("# Full Session Output")
  })

  test("returns full session when explicitly requested for running task", async () => {
    // #given
    const task = createTask({ status: "running" })
    const manager = createMockManager(task)
    const client = createMockClient({})
    const tool = createBackgroundOutput(manager, client)

    // #when
    const output = await tool.execute({ task_id: "task-1", full_session: true }, mockContext)

    // #then
    expect(output).toContain("# Full Session Output")
  })

  test("keeps legacy status output when full_session is explicitly false on running task", async () => {
    // #given
    const task = createTask({ status: "running" })
    const manager = createMockManager(task)
    const client = createMockClient({})
    const tool = createBackgroundOutput(manager, client)

    // #when
    const output = await tool.execute({ task_id: "task-1", full_session: false }, mockContext)

    // #then
    expect(output).toContain("# Task Status")
    expect(output).toContain("Task ID")
  })

  test("returns stable completed result even with a dangling empty assistant tail", async () => {
    // #given
    const task = createTask({
      status: "completed",
      startedAt: new Date("2026-01-01T00:00:00Z"),
      completedAt: new Date("2026-01-01T00:00:05Z"),
    })
    const manager = createMockManager(task)
    const client = createMockClient({
      "ses-1": [
        {
          id: "m1",
          info: {
            role: "assistant",
            time: { created: 1000, completed: 2000 },
            finish: "tool-calls",
          },
          parts: [{ type: "tool_result", content: "Located philosophy section in the left column." }],
        },
        {
          id: "m2",
          info: { role: "assistant", time: { created: 3000 } },
          parts: [{ type: "step-start" }],
        },
      ],
    })
    const tool = createBackgroundOutput(manager, client)

    // #when
    const first = await tool.execute({ task_id: "task-1", full_session: false }, mockContext)
    const second = await tool.execute({ task_id: "task-1", full_session: false }, mockContext)

    // #then
    expect(first).toContain("Located philosophy section in the left column.")
    expect(second).toContain("Located philosophy section in the left column.")
    expect(first).not.toContain("No new output since last check")
    expect(second).not.toContain("No new output since last check")
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

  test("recovers cleaned-up completed tasks from persisted launch records", async () => {
    await withTempDataHome(async (dataHome) => {
      createLaunchOnlyTaskDb(dataHome, {
        taskID: "bg-orphaned-output",
        sessionID: "ses-recovered",
        parentSessionID: "parent-recovered",
        parentMessageID: "msg-recovered",
        description: "Recovered task output",
        agent: "Sisyphus-Junior",
        category: "quick",
        includeStructuredTaskID: true,
      })

      const manager: BackgroundOutputManager = {
        getTask: () => undefined,
      }
      const client = createMockClient({
        "ses-recovered": [
          {
            id: "m1",
            info: {
              role: "assistant",
              time: { created: 1000, completed: 2000 },
              finish: "tool-calls",
            },
            parts: [{ type: "tool_result", content: "Recovered output from child session." }],
          },
          {
            id: "m2",
            info: { role: "assistant", time: { created: 3000 } },
            parts: [{ type: "step-start" }],
          },
        ],
      })
      const tool = createBackgroundOutput(manager, client)

      const output = await tool.execute({
        task_id: "bg-orphaned-output",
        full_session: false,
      }, mockContext)

      expect(output).toContain("Recovered output from child session.")
      expect(output).not.toContain("Task not found")
    })
  })
})


describe("background_output blocking", () => {
  test("block=true waits for task completion even with default full_session=true", async () => {
    // #given a task that transitions running → completed after 2 polls
    let pollCount = 0
    const task = createTask({ status: "running" })
    const manager: BackgroundOutputManager = {
      getTask: (id: string) => {
        if (id !== task.id) return undefined
        pollCount++
        if (pollCount >= 3) {
          task.status = "completed"
        }
        return task
      },
    }
    const client = createMockClient({
      "ses-1": [
        {
          id: "m1",
          info: { role: "assistant", time: "2026-01-01T00:00:00Z" },
          parts: [{ type: "text", text: "completed result" }],
        },
      ],
    })
    const tool = createBackgroundOutput(manager, client)

    // #when block=true, full_session not specified (defaults to true)
    const output = await tool.execute({
      task_id: "task-1",
      block: true,
      timeout: 10000,
    }, mockContext)

    // #then should have waited and returned full session output
    expect(task.status).toBe("completed")
    expect(pollCount).toBeGreaterThanOrEqual(3)
    expect(output).toContain("# Full Session Output")
    expect(output).toContain("completed result")
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
