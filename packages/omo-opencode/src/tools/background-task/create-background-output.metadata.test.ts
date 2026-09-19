/// <reference types="bun-types" />

import type { ToolContext } from "@opencode-ai/plugin/tool"
import { describe, expect, test } from "bun:test"
import type { BackgroundTask } from "../../features/background-agent"
import { clearPendingStore, consumeToolMetadata } from "../../features/tool-metadata-store"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import type { BackgroundOutputClient, BackgroundOutputManager } from "./clients"
import { BACKGROUND_TASK_DESCRIPTION } from "./constants"
import { createBackgroundOutput } from "./create-background-output"

const projectDir = "/Users/yeongyu/local-workspaces/oh-my-opencode"

type ToolContextWithCallID = ToolContext & {
  callID: string
}

describe("createBackgroundOutput metadata", () => {
  test("describes background task launch output as a bg id", () => {
    // #given, #when
    const description = BACKGROUND_TASK_DESCRIPTION

    // #then
    expect(description).toContain("background task ID")
    expect(description).toContain("bg_")
    expect(description).not.toContain("Returns task_id")
  })

  test("describes task_id as a background task id with session-ID fallback", () => {
    // #given
    const manager: BackgroundOutputManager = {
      getTaskBySessionId: () => undefined,
      getTask: () => undefined,
    }
    const client: BackgroundOutputClient = {
      session: {
        messages: async () => ({ data: [] }),
      },
    }
    const tool = createBackgroundOutput(manager, client)

    // #when
    const taskIdArg = unsafeTestValue<{ description?: string }>(tool.args.task_id)

    // #then
    expect(taskIdArg.description).toContain("background task ID")
    expect(taskIdArg.description).toContain("bg_")
    expect(taskIdArg.description).toContain("ses_")
    expect(taskIdArg.description).toContain("fallback")
  })

  test("omits sessionId metadata when task session is not yet assigned", async () => {
    // #given
    clearPendingStore()

    const task: BackgroundTask = {
      id: "task-1",
      sessionId: undefined,
      parentSessionId: "main-1",
      parentMessageId: "msg-1",
      description: "background task",
      prompt: "do work",
      agent: "test-agent",
      status: "running",
    }
    const manager: BackgroundOutputManager = {
      getTaskBySessionId: () => undefined,
      getTask: id => (id === task.id ? task : undefined),
    }
    const client: BackgroundOutputClient = {
      session: {
        messages: async () => ({ data: [] }),
      },
    }
    const tool = createBackgroundOutput(manager, client)
    const context = {
      sessionID: "test-session",
      messageID: "test-message",
      agent: "test-agent",
      directory: projectDir,
      worktree: projectDir,
      abort: new AbortController().signal,
      metadata: () => {},
      ask: async () => {},
      callID: "call-1",
    } as ToolContextWithCallID

    // #when
    await tool.execute({ task_id: task.id }, context)

    // #then
    expect(consumeToolMetadata("test-session", "call-1")).toEqual({
      title: "test-agent - background task",
      metadata: {
        agent: "test-agent",
        category: undefined,
        description: "background task",
        backgroundTaskId: "task-1",
      },
    })

    clearPendingStore()
  })

  test("explains when a session id is passed as the background task id", async () => {
    // #given
    const task: BackgroundTask = {
      id: "bg-real-task",
      sessionId: "ses-child-task",
      parentSessionId: "main-1",
      parentMessageId: "msg-1",
      description: "background task",
      prompt: "do work",
      agent: "test-agent",
      status: "completed",
    }
    const manager: BackgroundOutputManager = {
      getTaskBySessionId: () => undefined,
      getTask: id => (id === task.id ? task : undefined),
    }
    const client: BackgroundOutputClient = {
      session: {
        messages: async () => ({ data: [] }),
      },
    }
    const tool = createBackgroundOutput(manager, client)
    const context = {
      sessionID: "test-session",
      messageID: "test-message",
      agent: "test-agent",
      directory: projectDir,
      worktree: projectDir,
      abort: new AbortController().signal,
      metadata: () => {},
      ask: async () => {},
      callID: "call-1",
    } satisfies ToolContextWithCallID

    // #when
    const output = await tool.execute({ task_id: "ses-child-task" }, context)

    // #then
    expect(output).toContain("No background task is registered for this session ID")
    expect(output).toContain('session_read(session_id="ses-child-task")')
  })
})
