/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import type { BackgroundTask } from "../../features/background-agent"
import type { BackgroundOutputClient, BackgroundOutputManager } from "./clients"
import { createBackgroundOutput } from "./create-background-output"
import { formatTaskStatus } from "./task-status-format"

function createTask(overrides: Partial<BackgroundTask> = {}): BackgroundTask {
  return {
    id: "task-1",
    sessionId: "ses-1",
    parentSessionId: "main-1",
    parentMessageId: "msg-1",
    description: "background task",
    prompt: "do work",
    agent: "test-agent",
    status: "running",
    ...overrides,
  }
}

const mockContext = {
  sessionID: "test-session",
  messageID: "test-message",
  agent: "test-agent",
  abort: new AbortController().signal,
  metadata: () => {},
} as unknown as ToolContext

function createMockClient(): BackgroundOutputClient {
  return {
    session: {
      messages: async () => ({ data: [] }),
    },
  }
}

describe("formatTaskStatus recovered tasks", () => {
  test("surfaces task.error for an error task lost across restart", () => {
    // #given
    const task = createTask({
      status: "error",
      error: "session lost across restart",
    })

    // #when
    const output = formatTaskStatus(task)

    // #then
    expect(output).toContain("session lost across restart")
  })

  test("surfaces task.result recovery guidance for an interrupted task", () => {
    // #given
    const guidance =
      'Task interrupted by OpenCode restart. Inspect output with session_read(session_id="ses-1") or continue with task(task_id="ses-1", run_in_background=false).'
    const task = createTask({
      status: "interrupt",
      result: guidance,
    })

    // #when
    const output = formatTaskStatus(task)

    // #then
    expect(output).toContain('session_read(session_id="ses-1")')
    expect(output).toContain('task(task_id="ses-1"')
  })
})

describe("background_output recovered tasks", () => {
  test("surfaces error text for a registry-recovered error task", async () => {
    // #given
    const task = createTask({
      id: "bg_recovered_error",
      status: "error",
      error: "session lost across restart",
    })
    const manager: BackgroundOutputManager = {
      getTask: (id: string) => (id === task.id ? task : undefined),
    }
    const tool = createBackgroundOutput(manager, createMockClient())

    // #when
    const output = await tool.execute({ task_id: task.id }, mockContext)

    // #then
    expect(output).toContain("session lost across restart")
  })

  test("surfaces recovery guidance for a registry-recovered interrupted task", async () => {
    // #given
    const guidance =
      'Task interrupted by OpenCode restart. Inspect output with session_read(session_id="ses-1") or continue with task(task_id="ses-1", run_in_background=false).'
    const task = createTask({
      id: "bg_recovered_interrupt",
      status: "interrupt",
      result: guidance,
    })
    const manager: BackgroundOutputManager = {
      getTask: (id: string) => (id === task.id ? task : undefined),
    }
    const tool = createBackgroundOutput(manager, createMockClient())

    // #when
    const output = await tool.execute({ task_id: task.id }, mockContext)

    // #then
    expect(output).toContain('session_read(session_id="ses-1")')
  })
})
