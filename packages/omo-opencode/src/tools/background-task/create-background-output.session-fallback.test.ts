/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import { tmpdir } from "os"
import type { BackgroundTask } from "../../features/background-agent"
import { clearBackgroundOutputConsumptionState } from "../../shared/background-output-consumption"
import { resetMessageCursor } from "../../shared/session-cursor"
import type { BackgroundOutputClient, BackgroundOutputManager } from "./clients"
import { createBackgroundOutput } from "./create-background-output"

const projectDir = tmpdir()

const parentSessionID = "parent-session"
const evictedTaskID = "bg_evicted1"
const evictedSessionID = "ses-evicted-child"

type ToolContextWithCallID = ToolContext & {
  callID: string
}

const baseContext = {
  sessionID: parentSessionID,
  agent: "test-agent",
  directory: projectDir,
  worktree: projectDir,
  abort: new AbortController().signal,
  metadata: () => {},
  ask: async () => {},
  callID: "call-1",
} as const satisfies Partial<ToolContextWithCallID>

function createTask(overrides: Partial<BackgroundTask> = {}): BackgroundTask {
  return {
    id: evictedTaskID,
    sessionId: evictedSessionID,
    parentSessionId: parentSessionID,
    parentMessageId: "msg-parent",
    description: "evicted background task",
    prompt: "do work",
    agent: "test-agent",
    status: "completed",
    ...overrides,
  }
}

function createMockClient(): BackgroundOutputClient {
  return {
    session: {
      messages: async () => ({
        data: [
          {
            id: "m1",
            info: { role: "assistant", time: "2026-01-01T00:00:00Z" },
            parts: [{ type: "text", text: "final result" }],
          },
        ],
      }),
    },
  }
}

afterEach(() => {
  resetMessageCursor(evictedSessionID)
  clearBackgroundOutputConsumptionState()
})

describe("createBackgroundOutput session-ID fallback", () => {
  test("#given task unreachable by bg_ id but registered under its session ID #when background_output is called with the session ID #then the task result is returned", async () => {
    // #given
    const task = createTask()
    const manager: BackgroundOutputManager = {
      getTask: () => undefined,
      getTaskBySessionId: sessionId => (sessionId === evictedSessionID ? task : undefined),
    }
    const tool = createBackgroundOutput(manager, createMockClient())

    // #when
    const output = await tool.execute(
      { task_id: evictedSessionID },
      { ...baseContext, messageID: "msg-result-1" } as ToolContextWithCallID
    )

    // #then
    expect(output).toContain("final result")
  })

  test("#given session lookup misses on first attempt #when background_output retries #then the task is resolved on the retried lookup", async () => {
    // #given
    const task = createTask()
    let lookupCount = 0
    const manager: BackgroundOutputManager = {
      getTask: () => undefined,
      getTaskBySessionId: sessionId => {
        if (sessionId !== evictedSessionID) {
          return undefined
        }
        lookupCount += 1
        return lookupCount >= 2 ? task : undefined
      },
    }
    const tool = createBackgroundOutput(manager, createMockClient())

    // #when
    const output = await tool.execute(
      { task_id: evictedSessionID },
      { ...baseContext, messageID: "msg-result-2" } as ToolContextWithCallID
    )

    // #then
    expect(lookupCount).toBe(2)
    expect(output).toContain("final result")
  })

  test("#given no task registered for the session #when background_output is called with an unknown session ID #then the guidance message points at the session tools", async () => {
    // #given
    const manager: BackgroundOutputManager = {
      getTask: () => undefined,
      getTaskBySessionId: () => undefined,
    }
    const tool = createBackgroundOutput(manager, createMockClient())

    // #when
    const output = await tool.execute(
      { task_id: "ses-unknown-child" },
      { ...baseContext, messageID: "msg-result-3" } as ToolContextWithCallID
    )

    // #then
    expect(output).toContain("Task not found: ses-unknown-child")
    expect(output).toContain("session_read")
  })

  test("#given an unknown bg_ task ID #when background_output misses every lookup layer #then the failure message explains likely reasons and the session_read fallback", async () => {
    // #given
    const manager: BackgroundOutputManager = {
      getTask: () => undefined,
      getTaskBySessionId: () => undefined,
    }
    const tool = createBackgroundOutput(manager, createMockClient())

    // #when
    const output = await tool.execute(
      { task_id: "bg_gone0000" },
      { ...baseContext, messageID: "msg-result-4" } as ToolContextWithCallID
    )

    // #then
    expect(output).toContain("Task not found: bg_gone0000")
    expect(output).toContain("evicted")
    expect(output).toContain("never registered")
    expect(output).toContain("session_read")
  })
})
