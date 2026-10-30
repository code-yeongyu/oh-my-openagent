import { describe, expect, test } from "bun:test"

import { OMO_INTERNAL_INITIATOR_MARKER } from "../../shared/internal-initiator-marker"
import { OMO_RUNTIME_FALLBACK_RETRY_MARKER } from "../../shared/runtime-fallback-retry-marker"
import { createAutoRetryHelpers } from "./auto-retry"
import { createFallbackState } from "./fallback-state"
import type { HookDeps, RuntimeFallbackPluginInput } from "./types"
import { createRequestSnapshotStore } from "../../plugin/request-snapshots"

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
  test("a queued retry acquires the exact user snapshot before asynchronous metadata lookup", async () => {
    const store = createRequestSnapshotStore<string>()
    const sessionID = "snapshot-queued-runtime"
    store.set(sessionID, "original-user", "original-profile")
    const deps = createDeps({ count: 0 })
    deps.requestSnapshotRecovery = (id) => store.capture(id, "runtime")
    let resolveMessages!: (value: unknown) => void
    let response: unknown
    deps.ctx.client.session.messages = async () => response ?? await new Promise((resolve) => {
      resolveMessages = (value) => { response = value; resolve(value) }
    })
    deps.sessionStates.set(sessionID, createFallbackState("openai/primary"))
    const helpers = createAutoRetryHelpers(deps)
    const pending = helpers.autoRetryWithFallback(sessionID, "openai/backup", "explore", "session.error")
    const event = store.capture(sessionID)
    event.complete({ parentID: "original-user", error: { name: "APIError" }, time: { completed: 1 } }); event.release()
    store.set(sessionID, "later-user", "later-profile")
    expect(store.get(sessionID, "original-user")).toBe("original-profile")
    resolveMessages({ data: [{ info: { id: "original-user", role: "user" }, parts: [{ type: "text", text: "original prompt" }] }] })
    const outcome = await pending
    expect(outcome.accepted).toBe(true)
    expect(store.get(sessionID, "original-user")).toBe("original-profile")
    store.resume(sessionID, "original-user")
    const final = store.capture(sessionID)
    final.complete({ parentID: "original-user", finish: "stop", time: { completed: 2 } }); final.release()
    expect(store.get(sessionID, "original-user")).toBeUndefined()
    expect(store.get(sessionID, "later-user")).toBe("later-profile")
  })

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

  test("#given an existing fallback result is pending #when the next retry is accepted as queued #then queued pending state supersedes the previous fallback", async () => {
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
    const outcome = await helpers.autoRetryWithFallback(
      sessionID,
      "google/gemini-2.5-pro",
      undefined,
      "session.status",
    )

    // then
    expect(outcome).toEqual({ accepted: true, status: "queued" })
    expect(promptCalls.count).toBe(0)
    expect(deps.sessionAwaitingFallbackResult.has(sessionID)).toBe(true)
    expect(state.pendingFallbackModel).toBe("google/gemini-2.5-pro")
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
    expect(String(firstPart["text"] ?? "")).toContain("OMO_RUNTIME_FALLBACK_RETRY")
  })

  test("#given a reused internal continuation part #when auto retry dispatches a fallback #then it preserves the part identity and appends the fallback acknowledgement marker", async () => {
    // given
    const promptCalls = { count: 0 }
    const deps = createDeps(promptCalls)
    const internalText = `continue\n${OMO_INTERNAL_INITIATOR_MARKER}`
    let capturedBody: Record<string, unknown> | undefined
    deps.ctx.client.session.messages = async () => ({
      data: [
        {
          info: { role: "user", id: "msg_internal_continuation" },
          parts: [{ type: "text", text: internalText, id: "prt_internal_continuation" }],
        },
      ],
    })
    deps.ctx.client.session.promptAsync = async (input: { body: Record<string, unknown> }) => {
      promptCalls.count += 1
      capturedBody = input.body
      return {}
    }
    const helpers = createAutoRetryHelpers(deps)
    const sessionID = "session-reused-internal-continuation"
    deps.sessionStates.set(sessionID, createFallbackState("anthropic/claude-opus-4-7"))

    // when
    await helpers.autoRetryWithFallback(sessionID, "openai/gpt-5.4", undefined, "session.error")

    // then
    expect(promptCalls.count).toBe(1)
    expect(capturedBody?.messageID).toBe("msg_internal_continuation")
    expect(capturedBody?.parts).toEqual([
      {
        type: "text",
        text: `${internalText}\n${OMO_RUNTIME_FALLBACK_RETRY_MARKER}`,
        id: "prt_internal_continuation",
      },
    ])
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
    const staleLastAccess = Date.now() - 13 * 60 * 60 * 1000
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
    deps.sessionLastAccess.set(sessionID, Date.now() - 13 * 60 * 60 * 1000)
    deps.internallyAbortedSessions.add(sessionID)

    // when
    helpers.cleanupStaleSessions()

    // then
    expect(deps.sessionStates.has(sessionID)).toBe(false)
    expect(deps.sessionLastAccess.has(sessionID)).toBe(false)
    expect(deps.internallyAbortedSessions.has(sessionID)).toBe(false)
  })
})
