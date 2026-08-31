import { afterEach, describe, expect, test } from "bun:test"

import { createFallbackTimeoutHelpers } from "./auto-retry-timeout"
import { createMessageUpdateHandler } from "./message-update-handler"
import { createFallbackState } from "./fallback-state"
import type { AutoRetryHelpers } from "./auto-retry"
import type { HookDeps, RuntimeFallbackPluginInput } from "./types"
import { SessionCategoryRegistry } from "../../shared/session-category-registry"
import { installRuntimeFallbackTestClock, restoreRuntimeFallbackTestClock } from "./test-timeout-clock.test-support"

function createTestContext(): RuntimeFallbackPluginInput {
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
    ctx: createTestContext(),
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
      session_timeout_ms: 50,
    },
    pluginConfig: {
      categories: {
        test: {
          fallback_models: ["litellm/openai.eu.gpt-5.5"],
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

function createTimeoutHelpers(
  deps: HookDeps,
  abortCalls: { value: number },
  retryAgent: { value: string | undefined },
) {
  return createFallbackTimeoutHelpers(
    deps,
    async () => {
      abortCalls.value += 1
    },
    async (_sessionID, _model, resolvedAgent) => {
      retryAgent.value = resolvedAgent
      return { accepted: false, status: "blocked", reason: "test gate blocked dispatch" }
    },
  )
}

describe("rearmSessionFallbackTimeout", () => {
  afterEach(() => {
    SessionCategoryRegistry.clear()
    restoreRuntimeFallbackTestClock()
  })

  test("#given a fallback timeout is armed #when it is re-armed before its deadline #then it does not fire at the original deadline and fires a full window after the last re-arm", async () => {
    // given
    const clock = installRuntimeFallbackTestClock()
    const sessionID = "session-rearm-extends-deadline"
    SessionCategoryRegistry.register(sessionID, "test")
    const deps = createDeps()
    deps.sessionStates.set(sessionID, createFallbackState("openai/gpt-5.4"))
    const abortCalls = { value: 0 }
    const retryAgent = { value: undefined as string | undefined }
    const helpers = createTimeoutHelpers(deps, abortCalls, retryAgent)
    helpers.scheduleSessionFallbackTimeout(sessionID, "sisyphus")

    // when
    await clock.advanceBy(20)
    helpers.rearmSessionFallbackTimeout(sessionID)
    await clock.advanceBy(30)

    // then
    expect(abortCalls.value).toBe(0)

    // when the full window passes with no further progress
    await clock.advanceBy(30)

    // then
    expect(abortCalls.value).toBe(1)
    expect(retryAgent.value).toBe("sisyphus")
  })

  test("#given no fallback timeout is armed #when it is re-armed #then no timer is scheduled, before and after a cleared arm", async () => {
    // given
    const clock = installRuntimeFallbackTestClock()
    const sessionID = "session-rearm-when-unarmed"
    const deps = createDeps()
    deps.sessionStates.set(sessionID, createFallbackState("openai/gpt-5.4"))
    const abortCalls = { value: 0 }
    const retryAgent = { value: undefined as string | undefined }
    const helpers = createTimeoutHelpers(deps, abortCalls, retryAgent)

    // when
    helpers.rearmSessionFallbackTimeout(sessionID)

    // then
    expect(deps.sessionFallbackTimeouts.has(sessionID)).toBe(false)

    // when a timeout is armed and then explicitly cleared, then re-armed
    helpers.scheduleSessionFallbackTimeout(sessionID)
    helpers.clearSessionFallbackTimeout(sessionID)
    helpers.rearmSessionFallbackTimeout(sessionID)
    await clock.advanceBy(200)

    // then
    expect(deps.sessionFallbackTimeouts.has(sessionID)).toBe(false)
    expect(abortCalls.value).toBe(0)
  })

  test("#given a fallback result is awaited with an armed timeout #when assistant progress updates arrive without visible output #then each update re-arms the timeout and only prolonged silence aborts", async () => {
    // given
    const clock = installRuntimeFallbackTestClock()
    const sessionID = "session-progress-rearms-timeout"
    SessionCategoryRegistry.register(sessionID, "test")
    const deps = createDeps()
    const state = createFallbackState("openai/gpt-5.4")
    state.currentModel = "litellm/openai.eu.gpt-5.5"
    state.fallbackIndex = 0
    deps.sessionStates.set(sessionID, state)
    deps.sessionAwaitingFallbackResult.add(sessionID)
    const abortCalls = { value: 0 }
    const retryAgent = { value: undefined as string | undefined }
    const timeoutHelpers = createTimeoutHelpers(deps, abortCalls, retryAgent)
    const helpers: AutoRetryHelpers = {
      abortSessionRequest: async () => {
        abortCalls.value += 1
      },
      clearSessionFallbackTimeout: timeoutHelpers.clearSessionFallbackTimeout,
      scheduleSessionFallbackTimeout: timeoutHelpers.scheduleSessionFallbackTimeout,
      rearmSessionFallbackTimeout: timeoutHelpers.rearmSessionFallbackTimeout,
      autoRetryWithFallback: async () => ({ accepted: false, status: "blocked", reason: "test" }),
      resolveAgentForSessionFromContext: async () => undefined,
      cleanupStaleSessions: () => {},
    }
    const handler = createMessageUpdateHandler(deps, helpers)
    timeoutHelpers.scheduleSessionFallbackTimeout(sessionID, "sisyphus")

    // when progress arrives 20ms in, before the original 50ms deadline
    await clock.advanceBy(20)
    await handler({ sessionID, info: { role: "assistant", model: "litellm/openai.eu.gpt-5.5" } })

    // when the original deadline passes but the re-armed one has not
    await clock.advanceBy(30)
    expect(abortCalls.value).toBe(0)

    // when a second progress update arrives and then passes by
    await handler({ sessionID, info: { role: "assistant", model: "litellm/openai.eu.gpt-5.5" } })
    await clock.advanceBy(30)
    expect(abortCalls.value).toBe(0)

    // when silence outlasts the re-armed window
    await clock.advanceBy(40)

    // then
    expect(abortCalls.value).toBe(1)
  })
})
