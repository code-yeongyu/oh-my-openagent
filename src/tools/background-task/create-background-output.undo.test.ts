/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import type { BackgroundTask } from "../../features/background-agent"
import { createEventHandler } from "../../plugin/event"
import { clearBackgroundOutputConsumptionState } from "../../shared/background-output-consumption"
import { resetMessageCursor } from "../../shared/session-cursor"
import type { BackgroundOutputClient, BackgroundOutputManager } from "./clients"
import { createBackgroundOutput } from "./create-background-output"

const projectDir = "/Users/yeongyu/local-workspaces/oh-my-opencode"

const parentSessionID = "parent-session"
const taskSessionID = "task-session"

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
    id: "task-1",
    sessionID: taskSessionID,
    parentSessionID,
    parentMessageID: "msg-parent",
    description: "background task",
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

function createMockEventHandler() {
  return createEventHandler({
    ctx: {} as never,
    pluginConfig: {} as never,
    firstMessageVariantGate: {
      markSessionCreated: () => {},
      clear: () => {},
    },
    managers: {
      skillMcpManager: {
        disconnectSession: async () => {},
      },
      tmuxSessionManager: {
        onSessionCreated: async () => {},
        onSessionDeleted: async () => {},
      },
    } as never,
    hooks: {} as never,
  })
}

afterEach(() => {
  resetMessageCursor(taskSessionID)
  clearBackgroundOutputConsumptionState()
})

describe("createBackgroundOutput undo regression", () => {
  test("#given consumed background output #when undo removes the parent message #then output can be consumed again", async () => {
    // #given
    const task = createTask()
    const manager: BackgroundOutputManager = {
      getTask: id => (id === task.id ? task : undefined),
    }
    const tool = createBackgroundOutput(manager, createMockClient())
    const eventHandler = createMockEventHandler()

    // #when
    const firstOutput = await tool.execute(
      { task_id: task.id },
      { ...baseContext, messageID: "msg-result-1" } as ToolContextWithCallID
    )

    const secondOutput = await tool.execute(
      { task_id: task.id },
      { ...baseContext, callID: "call-2", messageID: "msg-result-2" } as ToolContextWithCallID
    )

    await eventHandler({
      event: {
        type: "message.removed",
        properties: {
          sessionID: parentSessionID,
          messageID: "msg-result-1",
        },
      },
    })

    const thirdOutput = await tool.execute(
      { task_id: task.id },
      { ...baseContext, callID: "call-3", messageID: "msg-result-3" } as ToolContextWithCallID
    )

    // #then
    expect(firstOutput).toContain("final result")
    expect(secondOutput).toContain("No new output since last check")
    expect(thirdOutput).toContain("final result")
  })
})
