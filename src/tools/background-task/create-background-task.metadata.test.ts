/// <reference types="bun-types" />

import type { PluginInput } from "@opencode-ai/plugin"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import { describe, expect, mock, test } from "bun:test"
import type { BackgroundManager } from "../../features/background-agent"
import { clearPendingStore, consumeToolMetadata } from "../../features/tool-metadata-store"
import { createBackgroundTask } from "./create-background-task"

const projectDir = "/Users/yeongyu/local-workspaces/oh-my-opencode"

type ToolContextWithCallID = ToolContext & {
  callID: string
}

describe("createBackgroundTask metadata", () => {
  test("omits sessionId metadata when session is not yet assigned", async () => {
    // #given
    clearPendingStore()

    const manager = {
      launch: mock(() => Promise.resolve({
        id: "task-1",
        sessionID: null,
        description: "Test task",
        agent: "test-agent",
        status: "pending",
      })),
      getTask: mock(() => undefined),
    } as unknown as BackgroundManager
    const client = {
      session: {
        messages: mock(() => Promise.resolve({ data: [] })),
      },
    } as unknown as PluginInput["client"]

    let capturedMetadata: { title?: string; metadata?: Record<string, unknown> } | undefined
    const tool = createBackgroundTask(manager, client)
    const originalDateNow = Date.now
    let dateNowCallCount = 0
    Date.now = () => {
      dateNowCallCount += 1
      return dateNowCallCount === 1 ? 0 : 30001
    }

    try {
      // #when
      const context: ToolContextWithCallID = {
        sessionID: "test-session",
        messageID: "test-message",
        agent: "test-agent",
        directory: projectDir,
        worktree: projectDir,
        abort: new AbortController().signal,
        ask: async () => {},
        callID: "call-1",
        metadata: input => {
          capturedMetadata = input
        },
      }

      const output = await tool.execute(
        {
          description: "Test background task",
          prompt: "Test prompt",
          agent: "test-agent",
        },
        context
      )

      // #then
      expect(output).toContain("Session ID: (not yet assigned)")
      expect(output).not.toContain('Session ID: pending')
      expect(capturedMetadata?.metadata).toEqual({})
      expect(consumeToolMetadata("test-session", "call-1")).toEqual({
        title: "Test background task",
        metadata: {},
      })
    } finally {
      Date.now = originalDateNow
      clearPendingStore()
    }
  })
})
