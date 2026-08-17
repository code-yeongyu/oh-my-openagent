/// <reference types="bun-types" />

import type { ToolContext } from "@opencode-ai/plugin/tool"
import { describe, expect, test } from "bun:test"
import type { BackgroundTask } from "../../features/background-agent"
import { TASK_DROPPED_REASON_DELEGATED_TO_PLAN } from "../../features/background-agent/constants"
import type { BackgroundOutputClient, BackgroundOutputManager } from "./clients"
import { createBackgroundOutput } from "./create-background-output"

type TestToolContext = ToolContext & { callID: string }

function createContext(): TestToolContext {
  return {
    sessionID: "ses_parent",
    messageID: "msg_parent",
    agent: "sisyphus",
    directory: "/tmp",
    worktree: "/tmp",
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
    callID: "call_1",
  }
}

function createClient(messagesCalled?: { value: boolean }): BackgroundOutputClient {
  return {
    session: {
      messages: async () => {
        if (messagesCalled) messagesCalled.value = true
        return { data: [] }
      },
    },
  }
}

function createDroppedTask(): BackgroundTask {
  return {
    id: "bg_dropped",
    sessionId: "ses_child",
    parentSessionId: "ses_parent",
    parentMessageId: "msg_parent",
    description: "explore code patterns",
    prompt: "find patterns",
    agent: "explore",
    status: "cancelled",
    droppedReason: TASK_DROPPED_REASON_DELEGATED_TO_PLAN,
    completedAt: new Date(),
  }
}

describe("background_output dropped tasks", () => {
  test("returns the dropped-task explanation before full-session formatting", async () => {
    const task = createDroppedTask()
    const manager: BackgroundOutputManager = { getTask: (id) => id === task.id ? task : undefined }
    const messagesCalled = { value: false }
    const tool = createBackgroundOutput(manager, createClient(messagesCalled))

    const output = await tool.execute({ task_id: task.id, full_session: true }, createContext())

    expect(output).toContain("This explore/librarian task was skipped")
    expect(output).toContain("plan agent was delegated")
    expect(output).toContain(task.id)
    expect(output).not.toContain("Context Gathering Task IDs")
    expect(messagesCalled.value).toBe(false)
  })

  test("keeps the normal cancelled status for unrelated cancellations", async () => {
    const task = { ...createDroppedTask(), id: "bg_cancelled", droppedReason: undefined, description: "normal task" }
    const manager: BackgroundOutputManager = { getTask: (id) => id === task.id ? task : undefined }
    const tool = createBackgroundOutput(manager, createClient())

    const output = await tool.execute({ task_id: task.id }, createContext())

    expect(output).toContain("# Task Status")
    expect(output).not.toContain("This explore/librarian task was skipped")
  })
})
