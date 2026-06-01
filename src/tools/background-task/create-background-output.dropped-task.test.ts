/// <reference types="bun-types" />

import type { ToolContext } from "@opencode-ai/plugin/tool"
import { describe, expect, test } from "bun:test"
import type { BackgroundTask } from "../../features/background-agent"
import { TASK_DROPPED_REASON_DELEGATED_TO_PLAN } from "../../features/background-agent/constants"
import type { BackgroundOutputClient, BackgroundOutputManager } from "./clients"
import { createBackgroundOutput } from "./create-background-output"

const projectDir = "/Users/yeongyu/local-workspaces/oh-my-opencode"

type ToolContextWithCallID = ToolContext & {
  callID: string
}

describe("createBackgroundOutput dropped task", () => {
  test("returns special message when task was dropped due to plan delegation", async () => {
    // #given
    const task: BackgroundTask = {
      id: "bg_dropped_task",
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

    const manager: BackgroundOutputManager = {
      getTask: id => (id === task.id ? task : undefined),
    }

    const client: BackgroundOutputClient = {
      session: {
        messages: async () => ({ data: [] }),
      },
    }

    const tool = createBackgroundOutput(manager, client)
    const context = {
      sessionID: "parent-session",
      messageID: "msg-1",
      agent: "test-agent",
      directory: projectDir,
      worktree: projectDir,
      abort: new AbortController().signal,
      metadata: () => {},
      ask: async () => {},
      callID: "call-1",
    } satisfies ToolContextWithCallID

    // #when
    const output = await tool.execute({ task_id: task.id }, context)

    // #then
    expect(output).toContain("This explore/librarian task was skipped")
    expect(output).toContain("plan agent was delegated")
    expect(output).toContain("Context Gathering Task IDs")
    expect(output).toContain("background_output")
    expect(output).toContain(task.id)
    expect(output).toContain("explore code patterns")
  })

  test("returns special message for dropped task when full session is requested", async () => {
    // #given
    const task: BackgroundTask = {
      id: "bg_dropped_full_session",
      sessionId: "ses_child",
      parentSessionId: "ses_parent",
      parentMessageId: "msg_parent",
      description: "research docs",
      prompt: "find docs",
      agent: "librarian",
      status: "cancelled",
      droppedReason: TASK_DROPPED_REASON_DELEGATED_TO_PLAN,
      completedAt: new Date(),
    }

    let messagesCalled = false
    const manager: BackgroundOutputManager = {
      getTask: id => (id === task.id ? task : undefined),
    }

    const client: BackgroundOutputClient = {
      session: {
        messages: async () => {
          messagesCalled = true
          return { data: [] }
        },
      },
    }

    const tool = createBackgroundOutput(manager, client)
    const context = {
      sessionID: "parent-session",
      messageID: "msg-1",
      agent: "test-agent",
      directory: projectDir,
      worktree: projectDir,
      abort: new AbortController().signal,
      metadata: () => {},
      ask: async () => {},
      callID: "call-1",
    } satisfies ToolContextWithCallID

    // #when
    const output = await tool.execute({ task_id: task.id, full_session: true }, context)

    // #then
    expect(output).toContain("This explore/librarian task was skipped")
    expect(output).toContain("plan agent was delegated")
    expect(output).toContain(task.id)
    expect(messagesCalled).toBe(false)
  })

  test("returns normal cancelled message for cancelled task without droppedReason", async () => {
    // #given
    const task: BackgroundTask = {
      id: "bg_normal_cancelled",
      sessionId: "ses_child",
      parentSessionId: "ses_parent",
      parentMessageId: "msg_parent",
      description: "normal task",
      prompt: "do work",
      agent: "explore",
      status: "cancelled",
      completedAt: new Date(),
    }

    const manager: BackgroundOutputManager = {
      getTask: id => (id === task.id ? task : undefined),
    }

    const client: BackgroundOutputClient = {
      session: {
        messages: async () => ({ data: [] }),
      },
    }

    const tool = createBackgroundOutput(manager, client)
    const context = {
      sessionID: "parent-session",
      messageID: "msg-1",
      agent: "test-agent",
      directory: projectDir,
      worktree: projectDir,
      abort: new AbortController().signal,
      metadata: () => {},
      ask: async () => {},
      callID: "call-1",
    } satisfies ToolContextWithCallID

    // #when
    const output = await tool.execute({ task_id: task.id }, context)

    // #then
    expect(output).toContain("# Task Status")
    expect(output).not.toContain("This explore/librarian task was skipped")
  })
})
