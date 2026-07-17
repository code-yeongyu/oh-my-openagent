import { describe, expect, test } from "bun:test"

import { createAutoRetryHelpers } from "./auto-retry"
import { createFallbackState } from "./fallback-state"
import type { HookDeps, RuntimeFallbackPluginInput } from "./types"

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

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
      restore_primary_after_cooldown: false,
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
  test("#given compact-flushed session with no recoverable user parts #when auto-retry fires the synthetic continuation #then the injected prompt is marked synthetic and carries the internal initiator marker (#4085)", async () => {
    // given - capture the actual parts forwarded to client.session.promptAsync
    const promptCalls: { count: number; lastBody: unknown } = { count: 0, lastBody: undefined }
    const deps = createDeps(promptCalls)
    // Post-compact case: messages() returns no user role entries, so
    // getLastUserRetryPayload falls through to the synthetic "continue".
    deps.ctx.client.session.messages = async () => ({ data: [] })
    deps.ctx.client.session.promptAsync = async (args: unknown) => {
      promptCalls.count += 1
      promptCalls.lastBody = (args as { body?: unknown })?.body
      return {}
    }
    const helpers = createAutoRetryHelpers(deps)
    const sessionID = "session-compact-flushed"
    const state = createFallbackState("anthropic/claude-opus-4-7")
    state.pendingFallbackModel = "openai/gpt-5.4"
    deps.sessionStates.set(sessionID, state)

    // when
    await helpers.autoRetryWithFallback(sessionID, "openai/gpt-5.4", undefined, "session.error")

    // then
    expect(promptCalls.count).toBe(1)
    const body = promptCalls.lastBody as { parts?: ReadonlyArray<Record<string, unknown>> } | undefined
    expect(body).toBeDefined()
    const parts = body?.parts ?? []
    expect(parts.length).toBe(1)
    const firstPart = parts[0] ?? {}
    expect(firstPart["type"]).toBe("text")
    // Without the marker + synthetic flag, OMO's continuation/keyword-detector
    // hooks treat this as a real user prompt and the TUI shows a bare "continue"
    // that the user never typed (see #4085 / Discord report).
    expect(firstPart["synthetic"]).toBe(true)
    expect(String(firstPart["text"] ?? "")).toContain("OMO_INTERNAL_INITIATOR")
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

  test("#given internal abort marker is set #when abort request runs #then stale cleanup TTL is refreshed", async () => {
    // given
    const promptCalls = { count: 0 }
    const deps = createDeps(promptCalls)
    const helpers = createAutoRetryHelpers(deps)
    const sessionID = "session-internal-abort-refresh"
    const staleLastAccess = Date.now() - 31 * 60 * 1000
    deps.sessionLastAccess.set(sessionID, staleLastAccess)

    // when
    await helpers.abortSessionRequest(sessionID, "session.status.retry-signal")

    // then
    expect(deps.internallyAbortedSessions.has(sessionID)).toBe(true)
    expect(deps.sessionLastAccess.get(sessionID)).toBeGreaterThan(staleLastAccess)
  })

  test("#given stale internal abort marker #when stale session cleanup runs #then the marker is cleared", () => {
    // given
    const promptCalls = { count: 0 }
    const deps = createDeps(promptCalls)
    const helpers = createAutoRetryHelpers(deps)
    const sessionID = "session-stale-internal-abort"
    deps.sessionStates.set(sessionID, createFallbackState("anthropic/claude-opus-4-7"))
    deps.sessionLastAccess.set(sessionID, Date.now() - 31 * 60 * 1000)
    deps.internallyAbortedSessions.add(sessionID)

    // when
    helpers.cleanupStaleSessions()

    // then
    expect(deps.sessionStates.has(sessionID)).toBe(false)
    expect(deps.sessionLastAccess.has(sessionID)).toBe(false)
    expect(deps.internallyAbortedSessions.has(sessionID)).toBe(false)
  })

  test("#given a stale session has a pending internal abort #when cleanup evicts it #then a late response stays invalidated", async () => {
    // given
    const promptCalls = { count: 0 }
    const deps = createDeps(promptCalls)
    const abortResponse = deferred<unknown>()
    const abortStarted = deferred<void>()
    deps.ctx.client.session.abort = async () => {
      abortStarted.resolve()
      return abortResponse.promise
    }
    const helpers = createAutoRetryHelpers(deps)
    const sessionID = "session-stale-pending-abort"

    // when
    const pendingAbort = helpers.abortSessionRequest(sessionID, "session.status.retry-signal")
    await abortStarted.promise
    deps.sessionLastAccess.set(sessionID, Date.now() - 31 * 60 * 1000)
    helpers.cleanupStaleSessions()
    abortResponse.resolve({})

    // then
    expect(await pendingAbort).toBe(false)
    expect(deps.internalAbortRequests?.has(sessionID)).toBe(false)
    expect(deps.internallyAbortedSessions.has(sessionID)).toBe(false)
  })
})
