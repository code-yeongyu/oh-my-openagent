import type { PluginInput } from "@opencode-ai/plugin"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { setMainSession, _resetForTesting } from "../../features/claude-code-session-state"
import {
  clearAllRuntimeFallbackActiveSessions,
  markRuntimeFallbackActive,
} from "../runtime-fallback/active-session-state"
import { createTodoContinuationEnforcer } from "."

describe("todo-continuation runtime fallback guard", () => {
  const promptCalls: Array<{ sessionID: string; text: string }> = []
  const toastCalls: Array<{ title: string; message: string }> = []

  const createMockPluginInput = (): PluginInput => ({
    client: {
      session: {
        todo: async () => ({ data: [
          { id: "1", content: "Task 1", status: "pending", priority: "high" },
        ]}),
        messages: async () => ({ data: [] }),
        prompt: async (opts: { path: { id: string }; body: { parts: Array<{ text: string }> } }) => {
          promptCalls.push({ sessionID: opts.path.id, text: opts.body.parts[0]?.text ?? "" })
          return {}
        },
        promptAsync: async (opts: { path: { id: string }; body: { parts: Array<{ text: string }> } }) => {
          promptCalls.push({ sessionID: opts.path.id, text: opts.body.parts[0]?.text ?? "" })
          return {}
        },
      },
      tui: {
        showToast: async (opts: { body: { title: string; message: string } }) => {
          toastCalls.push({ title: opts.body.title, message: opts.body.message })
          return {}
        },
      },
    },
    directory: "/tmp/test",
  })

  beforeEach(() => {
    promptCalls.length = 0
    toastCalls.length = 0
    _resetForTesting()
    clearAllRuntimeFallbackActiveSessions()
  })

  afterEach(() => {
    _resetForTesting()
    clearAllRuntimeFallbackActiveSessions()
  })

  test("should skip continuation while runtime fallback is active", async () => {
    const sessionID = "main-runtime-fallback-active"
    setMainSession(sessionID)
    markRuntimeFallbackActive(sessionID)

    const hook = createTodoContinuationEnforcer(createMockPluginInput(), {})

    await hook.handler({
      event: { type: "session.idle", properties: { sessionID } },
    })

    expect(promptCalls).toHaveLength(0)
    expect(toastCalls).toHaveLength(0)
  })
})
