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
} as unknown as ToolContext

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

function createMockClient(): BackgroundOutputClient {
  return {
    session: {
      messages: async () => ({ data: [] }),
    },
  }
}

describe("createBackgroundOutput block=true polling", () => {
  test("returns terminal error output when task fails during blocking wait", async () => {
    // #given
    let pollCount = 0
    const task = createTask({ status: "running" })
    const manager: BackgroundOutputManager = {
      getTask: (id: string) => {
        if (id !== task.id) return undefined

        pollCount += 1
        if (pollCount >= 2) {
          task.status = "error"
          task.error = "task failed"
        }

        return task
      },
    }

    const tool = createBackgroundOutput(manager, createMockClient())

    // #when
    const output = await tool.execute(
      {
        task_id: task.id,
        block: true,
        timeout: 3000,
        full_session: false,
      },
      mockContext
    )

    // #then
    expect(pollCount).toBeGreaterThanOrEqual(2)
    expect(output).toContain("Status | **error**")
    expect(output).not.toContain("Timed out waiting")
  })

  test("returns latest output with timeout note when task stays running", async () => {
    // #given
    let pollCount = 0
    const task = createTask({ status: "running" })
    const manager: BackgroundOutputManager = {
      getTask: (id: string) => {
        if (id !== task.id) return undefined
        pollCount += 1
        return task
      },
    }

    const tool = createBackgroundOutput(manager, createMockClient())

    // #when
    const output = await tool.execute(
      {
        task_id: task.id,
        block: true,
        timeout: 10,
      },
      mockContext
    )

    // #then
    expect(pollCount).toBeGreaterThanOrEqual(2)
    expect(output).toContain("# Full Session Output")
    expect(output).toContain("Timed out waiting")
    expect(output).toContain("still running")
  })
})
