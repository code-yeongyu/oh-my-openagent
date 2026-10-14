import { describe, expect, spyOn, test } from "bun:test"

import type { AutoRetryHelpers } from "./auto-retry"
import { dispatchFallbackRetry } from "./fallback-retry-dispatcher"
import { createFallbackState } from "./fallback-state"
import { createFallbackTimeoutHelpers } from "./auto-retry-timeout"
import type { HookDeps, RuntimeFallbackPluginInput } from "./types"

function createContext(toastMessages: string[]): RuntimeFallbackPluginInput {
  return {
    client: {
      session: {
        abort: async () => ({}),
        messages: async () => ({ data: [] }),
        promptAsync: async () => ({}),
      },
      tui: {
        showToast: async (input) => {
          toastMessages.push(input.body.message)
          return {}
        },
      },
    },
    directory: "/test/dir",
  }
}

function createDeps(toastMessages: string[]): HookDeps {
  return {
    ctx: createContext(toastMessages),
    config: {
      enabled: true,
      retry_on_errors: [429, 503, 529],
      max_fallback_attempts: 3,
      cooldown_seconds: 60,
      timeout_seconds: 30,
      notify_on_fallback: true,
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

function createRejectedDispatchHelpers(dispatchCalls: string[]): AutoRetryHelpers {
  return {
    abortSessionRequest: async () => {},
    clearSessionFallbackTimeout: () => {},
    scheduleSessionFallbackTimeout: () => {},
    autoRetryWithFallback: async (_sessionID, model) => {
      dispatchCalls.push(model)
      return { accepted: false, status: "blocked", reason: "test gate blocked dispatch" }
    },
    resolveAgentForSessionFromContext: async () => undefined,
    cleanupStaleSessions: () => {},
  }
}

describe("dispatchFallbackRetry", () => {
  test("refused dispatch releases an existing recovery claim state", async () => {
    const deps = createDeps([])
    const sessionID = "session-refused"
    const state = createFallbackState("openai/gpt-5.4")
    deps.sessionStates.set(sessionID, state)
    deps.sessionAwaitingFallbackResult.add(sessionID)
    deps.sessionRetryInFlight.add(sessionID)
    let cleared = false
    const helpers = createRejectedDispatchHelpers([])
    helpers.clearSessionFallbackTimeout = () => { cleared = true }

    await dispatchFallbackRetry(deps, helpers, {
      sessionID, state, fallbackModels: ["openai/gpt-5.5"], source: "session.error",
    })

    expect(deps.sessionAwaitingFallbackResult.has(sessionID)).toBe(false)
    expect(deps.sessionRetryInFlight.has(sessionID)).toBe(false)
    expect(cleared).toBe(true)
  })

  for (const refusal of [false, true]) {
    test(`timeout releases recovery ownership after ${refusal ? "refused dispatch" : "model exhaustion"}`, async () => {
      const deps = createDeps([])
      const sessionID = "session-timeout-release"
      const state = createFallbackState("openai/gpt-5.4")
      deps.sessionStates.set(sessionID, state)
      deps.sessionAwaitingFallbackResult.add(sessionID)
      deps.pluginConfig = {
        agents: { oracle: { fallback_models: refusal ? ["openai/gpt-5.5"] : [] } },
      }
      let fireTimeout: (() => Promise<void>) | undefined
      const timer = spyOn(globalThis, "setTimeout").mockImplementation(((callback: Parameters<typeof setTimeout>[0]) => {
        fireTimeout = callback as () => Promise<void>
        return 1 as unknown as ReturnType<typeof setTimeout>
      }) as typeof setTimeout)
      try {
        const helpers = createFallbackTimeoutHelpers(deps, async () => {}, async () => ({
          accepted: false, status: "blocked", reason: "test refusal",
        }))
        helpers.scheduleSessionFallbackTimeout(sessionID, "oracle")
        await fireTimeout?.()
        expect(deps.sessionAwaitingFallbackResult.has(sessionID)).toBe(false)
        expect(deps.sessionFallbackTimeouts.has(sessionID)).toBe(false)
      } finally {
        timer.mockRestore()
      }
    })
  }

  test("#given fallback dispatch is blocked #when fallback retry runs #then state is restored and no success toast is shown", async () => {
    // given
    const toastMessages: string[] = []
    const dispatchCalls: string[] = []
    const deps = createDeps(toastMessages)
    const helpers = createRejectedDispatchHelpers(dispatchCalls)
    const sessionID = "session-dispatch-rejected"
    const state = createFallbackState("openai/gpt-5.4")
    deps.sessionStates.set(sessionID, state)

    // when
    await dispatchFallbackRetry(deps, helpers, {
      sessionID,
      state,
      fallbackModels: ["litellm/openai.eu.gpt-5.5"],
      source: "message.updated",
    })

    // then
    expect(dispatchCalls).toEqual(["litellm/openai.eu.gpt-5.5"])
    expect(toastMessages).toEqual([])
    expect(state.currentModel).toBe("openai/gpt-5.4")
    expect(state.fallbackIndex).toBe(-1)
    expect(state.attemptCount).toBe(0)
    expect(state.pendingFallbackModel).toBe(undefined)
    expect(state.failedModels.size).toBe(0)
  })
})
