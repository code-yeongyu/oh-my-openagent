/// <reference types="bun-types" />

import type { ToolContext } from "@opencode-ai/plugin/tool"
import { describe, expect, test } from "bun:test"
import type { BackgroundTask } from "../../features/background-agent"
import { clearPendingStore, consumeToolMetadata } from "../../features/tool-metadata-store"
import type { BackgroundOutputClient, BackgroundOutputManager } from "./clients"
import { createBackgroundOutput } from "./create-background-output"

const projectDir = "/Users/yeongyu/local-workspaces/oh-my-opencode"

type ToolContextWithCallID = ToolContext & {
  callID: string
}

describe("createBackgroundOutput metadata", () => {
  test("omits sessionId metadata when task session is not yet assigned", async () => {
    // #given
    clearPendingStore()

    const task: BackgroundTask = {
      id: "task-1",
      sessionID: undefined,
      parentSessionID: "main-1",
      parentMessageID: "msg-1",
      description: "background task",
      prompt: "do work",
      agent: "test-agent",
      status: "running",
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
        task_id: "task-1",
      },
    })

    clearPendingStore()
  })
})
