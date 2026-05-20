import { afterEach, describe, expect, test } from "bun:test"

import { createAutoRetryHelpers } from "./auto-retry"
import { createFallbackState } from "./fallback-state"
import { getLastUserRetryPayload } from "./last-user-retry-parts"
import type { HookDeps, RuntimeFallbackPluginInput } from "./types"
import {
  clearDelegatedChildSessionBootstrap,
  getDelegatedChildSessionBootstrap,
  registerDelegatedChildSessionBootstrap,
} from "../../shared/delegated-child-session-bootstrap"
import {
  cancelQueuedInternalPrompts,
  dispatchInternalPrompt,
  releaseAllPromptAsyncReservationsForTesting,
  releasePromptAsyncReservation,
} from "../shared/prompt-async-gate"

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
    prompt: async () => {
      promptCalls.count += 1
      return {}
    },
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
  afterEach(() => {
    releaseAllPromptAsyncReservationsForTesting()
    clearDelegatedChildSessionBootstrap("session-bootstrap-reuse")
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

  test("#given sync prompt reservation is active #when session.status fallback retries #then stale runtime fallback prompts do not dispatch after the reserved prompt completes", async () => {
    // given
    const promptCalls = { count: 0 }
    const deps = createDeps(promptCalls)
    const helpers = createAutoRetryHelpers(deps)
    const sessionID = "session-auto-retry-queued"
    const state = createFallbackState("cliproxy/deepseek-v4-flash-free")
    deps.sessionStates.set(sessionID, state)

    const heldPrompt = dispatchInternalPrompt({
      mode: "sync",
      client: deps.ctx.client,
      sessionID,
      input: {
        path: { id: sessionID },
      },
      source: "model-suggestion-retry:sync",
      settleMs: 0,
      checkStatus: false,
      checkToolState: false,
      queueBehavior: "defer",
    })

    // when
    await helpers.autoRetryWithFallback(sessionID, "openai/gpt-5.4", undefined, "session.status")
    const heldResult = await heldPrompt
    const released = releasePromptAsyncReservation(sessionID, "test-release", {
      reservedBy: "model-suggestion-retry:sync",
    })
    expect(released).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))

    // then
    expect(heldResult.status).toBe("dispatched")
    expect(promptCalls.count).toBe(1)
    expect(deps.sessionAwaitingFallbackResult.has(sessionID)).toBe(true)
    expect(deps.sessionRetryInFlight.has(sessionID)).toBe(false)
    expect(cancelQueuedInternalPrompts(sessionID, {
      sourcePrefix: "runtime-fallback:",
    })).toBe(0)
  })

  test("#given runtime fallback cleanup already ran #when checking the queue again #then no stale runtime fallback prompts remain", async () => {
    // given
    const promptCalls = { count: 0 }
    const deps = createDeps(promptCalls)
    const helpers = createAutoRetryHelpers(deps)
    const sessionID = "session-auto-retry-cleanup"
    const state = createFallbackState("cliproxy/deepseek-v4-flash-free")
    deps.sessionStates.set(sessionID, state)

    const heldPrompt = dispatchInternalPrompt({
      mode: "sync",
      client: deps.ctx.client,
      sessionID,
      input: {
        path: { id: sessionID },
      },
      source: "model-suggestion-retry:sync",
      settleMs: 0,
      checkStatus: false,
      checkToolState: false,
      queueBehavior: "defer",
    })

    await helpers.autoRetryWithFallback(sessionID, "openai/gpt-5.4", undefined, "session.status")
    const heldResult = await heldPrompt
    expect(heldResult.status).toBe("dispatched")

    const released = releasePromptAsyncReservation(sessionID, "test-release", {
      reservedBy: "model-suggestion-retry:sync",
    })
    expect(released).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))

    // when / then
    expect(cancelQueuedInternalPrompts(sessionID, {
      sourcePrefix: "runtime-fallback:",
    })).toBe(0)
  })

  test("#given the latest stored user turn is an internal retry prompt #when resolving the retry payload #then it reuses the last real user text instead of the internal retry", async () => {
    // given
    const payload = getLastUserRetryPayload({
      data: [
        {
          info: { role: "user" },
          parts: [{ type: "text", text: "original real prompt" }],
        },
        {
          info: { role: "assistant" },
          parts: [],
        },
        {
          info: { role: "user" },
          parts: [{ type: "text", text: "internal retry\n<!-- OMO_INTERNAL_INITIATOR -->" }],
        },
      ],
    })

    // then
    expect(payload.retryParts).toEqual([{ type: "text", text: "original real prompt" }])
  })

  test("#given delegated child history is still empty after one fallback #when resolving a later retry payload #then it keeps reusing bootstrap prompt text", async () => {
    // given
    const sessionID = "session-bootstrap-reuse"
    registerDelegatedChildSessionBootstrap({
      sessionID,
      promptText: "original delegated prompt",
      system: "delegated system",
      tools: { call_omo_agent: true, question: false },
    })

    // when
    const firstPayload = getLastUserRetryPayload({ data: [] }, sessionID)
    const secondPayload = getLastUserRetryPayload({
      data: [
        {
          role: "assistant",
          time: { completed: 123 },
        },
      ],
    }, sessionID)

    // then
    expect(firstPayload.retryParts).toEqual([{ type: "text", text: "original delegated prompt\n<!-- OMO_INTERNAL_INITIATOR -->" }])
    expect(secondPayload.retryParts).toEqual([{ type: "text", text: "original delegated prompt\n<!-- OMO_INTERNAL_INITIATOR -->" }])
    expect(getDelegatedChildSessionBootstrap(sessionID)?.retryParts).toEqual(firstPayload.retryParts)
  })

})
