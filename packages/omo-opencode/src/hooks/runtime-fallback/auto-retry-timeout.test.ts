import { afterEach, describe, expect, test } from "bun:test"

import { createFallbackTimeoutHelpers } from "./auto-retry-timeout"
import { createFallbackState } from "./fallback-state"
import type { HookDeps, RuntimeFallbackPluginInput } from "./types"
import { SessionCategoryRegistry } from "../../shared/session-category-registry"

function createContext(): RuntimeFallbackPluginInput {
  return {
    client: {
      session: {
        abort: async () => ({}),
        messages: async () => ({ data: [] }),
        promptAsync: async () => ({}),
      },
      tui: {
        showToast: async () => ({}),
      },
    },
    directory: "/test/dir",
  }
}

function createDeps(): HookDeps {
  return {
    ctx: createContext(),
    config: {
      enabled: true,
      retry_on_errors: [429, 503, 529],
      max_fallback_attempts: 3,
      cooldown_seconds: 60,
      timeout_seconds: 30,
      notify_on_fallback: true,
      restore_primary_after_cooldown: false,
    },
    options: {
      session_timeout_ms: 1,
    },
    pluginConfig: {
      categories: {
        test: {
          fallback_models: ["litellm/openai.eu.gpt-5.5", "google/gemini-2.5-pro"],
        },
      },
    },
    sessionStates: new Map(),
    sessionLastAccess: new Map(),
    sessionRetryInFlight: new Set(),
    sessionAwaitingFallbackResult: new Set(),
    sessionFallbackTimeouts: new Map(),
    sessionStatusRetryKeys: new Map(),
    internallyAbortedSessions: new Set(),
  }
}

describe("createFallbackTimeoutHelpers", () => {
  afterEach(() => {
    SessionCategoryRegistry.clear()
  })

  test("#given timeout fallback dispatch is blocked #when the timeout fires #then fallback state is restored", async () => {
    // given
    const sessionID = "session-timeout-dispatch-blocked"
    SessionCategoryRegistry.register(sessionID, "test")
    const deps = createDeps()
    const state = createFallbackState("openai/gpt-5.4")
    deps.sessionStates.set(sessionID, state)

    let retryModel: string | undefined
    let resolveRetry: (() => void) | undefined
    const retryCalled = new Promise<void>((resolve) => {
      resolveRetry = resolve
    })
    const helpers = createFallbackTimeoutHelpers(
      deps,
      async () => true,
      async (_sessionID, model) => {
        retryModel = model
        resolveRetry?.()
        return { accepted: false, status: "blocked", reason: "test gate blocked dispatch" }
      },
    )

    // when
    helpers.scheduleSessionFallbackTimeout(sessionID)
    await Promise.race([
      retryCalled,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("timer did not fire")), 1000)
      }),
    ])
    await new Promise((resolve) => setTimeout(resolve, 0))

    // then
    expect(retryModel).toBe("litellm/openai.eu.gpt-5.5")
    expect(state.currentModel).toBe("openai/gpt-5.4")
    expect(state.fallbackIndex).toBe(-1)
    expect(state.attemptCount).toBe(0)
    expect(state.pendingFallbackModel).toBe(undefined)
    expect(state.failedModels.size).toBe(0)
  })

  test("#given an accepted fallback is awaiting its result #when timeout escalation is blocked #then the restored awaiting state keeps a timeout armed", async () => {
    // given
    const sessionID = "session-timeout-awaiting-dispatch-blocked"
    SessionCategoryRegistry.register(sessionID, "test")
    const deps = createDeps()
    deps.options = {
      session_timeout_ms: 1,
    }
    const state = createFallbackState("openai/gpt-5.4")
    state.currentModel = "litellm/openai.eu.gpt-5.5"
    state.fallbackIndex = 0
    deps.sessionStates.set(sessionID, state)
    deps.sessionAwaitingFallbackResult.add(sessionID)

    let resolveRetry: (() => void) | undefined
    const retryCalled = new Promise<void>((resolve) => {
      resolveRetry = resolve
    })
    const helpers = createFallbackTimeoutHelpers(
      deps,
      async () => true,
      async () => {
        resolveRetry?.()
        return { accepted: false, status: "blocked", reason: "test gate blocked dispatch" }
      },
    )

    // when
    helpers.scheduleSessionFallbackTimeout(sessionID)
    await Promise.race([
      retryCalled,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("timer did not fire")), 1000)
      }),
    ])
    await new Promise((resolve) => setTimeout(resolve, 0))

    // then
    expect(deps.sessionAwaitingFallbackResult.has(sessionID)).toBe(true)
    expect(deps.sessionFallbackTimeouts.has(sessionID)).toBe(true)
    helpers.clearSessionFallbackTimeout(sessionID)
  })

  test("#given timeout escalation cannot abort the active request #when the timeout fires #then it preserves retry ownership and does not dispatch a fallback", async () => {
    const sessionID = "session-timeout-abort-failed"
    SessionCategoryRegistry.register(sessionID, "test")
    const deps = createDeps()
    const state = createFallbackState("openai/gpt-5.4")
    state.pendingFallbackModel = "litellm/openai.eu.gpt-5.5"
    state.pendingFallbackPromptMayHaveBeenAccepted = true
    deps.sessionStates.set(sessionID, state)
    deps.sessionRetryInFlight.add(sessionID)

    let resolveAbort: (() => void) | undefined
    const abortCalled = new Promise<void>((resolve) => {
      resolveAbort = resolve
    })
    let dispatchCount = 0
    const helpers = createFallbackTimeoutHelpers(
      deps,
      async () => {
        resolveAbort?.()
        return false
      },
      async () => {
        dispatchCount += 1
        return { accepted: true, status: "dispatched" }
      },
    )

    helpers.scheduleSessionFallbackTimeout(sessionID)
    await Promise.race([
      abortCalled,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("timer did not fire")), 1000)
      }),
    ])
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(dispatchCount).toBe(0)
    expect(deps.sessionRetryInFlight.has(sessionID)).toBe(true)
    expect(state.pendingFallbackModel).toBe("litellm/openai.eu.gpt-5.5")
    expect(state.pendingFallbackPromptMayHaveBeenAccepted).toBe(true)
    expect(state.currentModel).toBe("openai/gpt-5.4")
    expect(state.attemptCount).toBe(0)
  })
})
