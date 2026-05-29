import { describe, expect, test } from "bun:test"

import { createAutoRetryHelpers } from "./auto-retry"
import { createFallbackState } from "./fallback-state"
import type { HookDeps, RuntimeFallbackPluginInput } from "./types"

function createContext(promptCalls: { count: number }): RuntimeFallbackPluginInput {
  const session = {
    abort: async () => ({}),
    messages: async () => ({
      data: [
        {
          info: { role: "user" },
          parts: [{ type: "text", text: "retry this" }],
        },
      ],
    }),
    promptAsync: async () => {
      promptCalls.count += 1
      return {}
    },
    status: async () => ({ data: { "session-auto-retry": { type: "busy" } } }),
  }
  return {
    client: {
      session,
      tui: {
        showToast: async () => ({}),
      },
    },
    directory: "/test/dir",
  }
}

function createDeps(promptCalls: { count: number }): HookDeps {
  return {
    ctx: createContext(promptCalls),
    config: {
      enabled: true,
      retry_on_errors: [429, 503, 529],
      max_fallback_attempts: 3,
      cooldown_seconds: 60,
      timeout_seconds: 0,
      notify_on_fallback: false,
    },
    options: undefined,
    pluginConfig: undefined,
    sessionStates: new Map(),
    sessionLastAccess: new Map(),
    sessionRetryInFlight: new Set(),
    sessionAwaitingFallbackResult: new Set(),
    sessionFallbackTimeouts: new Map(),
    sessionStatusRetryKeys: new Map(),
    internallyAbortedSessions: new Set(),
  }
}

describe("createAutoRetryHelpers", () => {
  test("#given fallback prompt returns ambiguous EOF #when auto retry runs #then pending fallback is marked as possibly accepted", async () => {
    // given
    const promptCalls = { count: 0 }
    const deps = createDeps(promptCalls)
    deps.ctx.client.session.promptAsync = async () => {
      promptCalls.count += 1
      throw new Error("JSON Parse error: Unexpected EOF")
    }
    const helpers = createAutoRetryHelpers(deps)
    const sessionID = "session-auto-retry-ambiguous"
    const state = createFallbackState("anthropic/claude-opus-4-7")
    state.pendingFallbackModel = "openai/gpt-5.4"
    deps.sessionStates.set(sessionID, state)

    // when
    await helpers.autoRetryWithFallback(sessionID, "openai/gpt-5.4", undefined, "session.error")

    // then
    expect(promptCalls.count).toBe(1)
    expect(deps.sessionAwaitingFallbackResult.has(sessionID)).toBe(true)
    expect(state.pendingFallbackModel).toBe("openai/gpt-5.4")
    expect(state.pendingFallbackPromptMayHaveBeenAccepted).toBe(true)
  })

  test("#given an existing fallback result is pending #when a new fallback retry is skipped by the prompt gate #then the previous pending state is preserved", async () => {
    // given
    const promptCalls = { count: 0 }
    const deps = createDeps(promptCalls)
    const helpers = createAutoRetryHelpers(deps)
    const sessionID = "session-auto-retry"
    const state = createFallbackState("anthropic/claude-opus-4-7")
    state.pendingFallbackModel = "openai/gpt-5.4"
    deps.sessionStates.set(sessionID, state)
    deps.sessionAwaitingFallbackResult.add(sessionID)

    // when
    await helpers.autoRetryWithFallback(sessionID, "google/gemini-2.5-pro", undefined, "session.status")

    // then
    expect(promptCalls.count).toBe(0)
    expect(deps.sessionAwaitingFallbackResult.has(sessionID)).toBe(true)
    expect(state.pendingFallbackModel).toBe("openai/gpt-5.4")
  })

  test("#given a persisted user message with id and part ids #when auto retry runs #then the fallback prompt reuses the original messageID and part ids", async () => {
    // given
    const promptCalls = { count: 0 }
    const deps = createDeps(promptCalls)
    let capturedBody: Record<string, unknown> | undefined
    deps.ctx.client.session.messages = async () => ({
      data: [
        {
          info: { role: "user", id: "msg_original_user" },
          parts: [{ type: "text", text: "retry this", id: "prt_original" }],
        },
      ],
    })
    deps.ctx.client.session.promptAsync = async (input: { body: Record<string, unknown> }) => {
      promptCalls.count += 1
      capturedBody = input.body
      return {}
    }
    const helpers = createAutoRetryHelpers(deps)
    const sessionID = "session-auto-retry-dedup"
    const state = createFallbackState("anthropic/claude-opus-4-7")
    deps.sessionStates.set(sessionID, state)

    // when
    await helpers.autoRetryWithFallback(sessionID, "openai/gpt-5.4", undefined, "session.error")

    // then
    expect(promptCalls.count).toBe(1)
    expect(capturedBody?.messageID).toBe("msg_original_user")
    expect(capturedBody?.parts).toEqual([{ type: "text", text: "retry this", id: "prt_original" }])
  })

  test("#given no persisted user message #when auto retry falls back to synthetic continuation #then no stale messageID is sent", async () => {
    // given
    const promptCalls = { count: 0 }
    const deps = createDeps(promptCalls)
    let capturedBody: Record<string, unknown> | undefined
    deps.ctx.client.session.messages = async () => ({ data: [] })
    deps.ctx.client.session.promptAsync = async (input: { body: Record<string, unknown> }) => {
      promptCalls.count += 1
      capturedBody = input.body
      return {}
    }
    const helpers = createAutoRetryHelpers(deps)
    const sessionID = "session-auto-retry-synthetic"
    const state = createFallbackState("anthropic/claude-opus-4-7")
    deps.sessionStates.set(sessionID, state)

    // when
    await helpers.autoRetryWithFallback(sessionID, "openai/gpt-5.4", undefined, "session.error")

    // then
    expect(promptCalls.count).toBe(1)
    expect(capturedBody?.messageID).toBeUndefined()
    expect(capturedBody?.parts).toEqual([{ type: "text", text: "continue" }])
  })
})
