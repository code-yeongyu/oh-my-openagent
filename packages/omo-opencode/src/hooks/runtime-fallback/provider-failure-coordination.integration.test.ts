import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import {
  createModelFallbackHook,
  getNextFallback,
  setPendingModelFallback,
  setSessionFallbackChain,
} from "../model-fallback/hook"
import {
  _resetMemCacheForTesting,
  updateConnectedProvidersCache,
} from "../../shared/connected-providers-cache"
import { clearAllProviderFailures } from "../../shared/provider-failure-state"
import { clearSessionModel, setSessionModel } from "../../shared/session-model-state"
import type { AutoRetryHelpers } from "./auto-retry"
import { createEventHandler } from "./event-handler"
import type { HookDeps, RuntimeFallbackPluginInput } from "./types"

function createContext(): RuntimeFallbackPluginInput {
  return {
    client: {
      session: {
        abort: async () => ({}),
        messages: async () => ({ data: [] }),
        promptAsync: async () => ({}),
      },
      tui: { showToast: async () => ({}) },
    },
    directory: "/test/dir",
  }
}

function createDeps(): HookDeps {
  return {
    ctx: createContext(),
    config: {
      enabled: true,
      retry_on_errors: [429, 503],
      max_fallback_attempts: 3,
      cooldown_seconds: 60,
      timeout_seconds: 30,
      notify_on_fallback: false,
      restore_primary_after_cooldown: false,
    },
    options: undefined,
    pluginConfig: {},
    sessionStates: new Map(),
    sessionLastAccess: new Map(),
    sessionRetryInFlight: new Set(),
    sessionAwaitingFallbackResult: new Set(),
    sessionFallbackTimeouts: new Map(),
    sessionStatusRetryKeys: new Map(),
    internallyAbortedSessions: new Set(),
  }
}

function createHelpers(deps: HookDeps): AutoRetryHelpers {
  return {
    abortSessionRequest: async () => {},
    clearSessionFallbackTimeout: (sessionID: string) => {
      deps.sessionFallbackTimeouts.delete(sessionID)
    },
    scheduleSessionFallbackTimeout: () => {},
    autoRetryWithFallback: async () => {},
    resolveAgentForSessionFromContext: async () => undefined,
    cleanupStaleSessions: () => {},
  }
}

describe("provider failure coordination", () => {
  beforeEach(() => {
    clearAllProviderFailures()
    _resetMemCacheForTesting()
    clearSessionModel("session-a")
  })

  afterEach(() => {
    clearAllProviderFailures()
    _resetMemCacheForTesting()
    clearSessionModel("session-a")
  })

  it("#given Google exhausts quota for session A #when proactive fallback selects for sessions A and B #then only A skips Google", async () => {
    const failedSessionID = "session-a"
    const unrelatedSessionID = "session-b"
    const deps = createDeps()
    const runtimeHandler = createEventHandler(deps, createHelpers(deps))
    const modelFallback = createModelFallbackHook()
    setSessionModel(failedSessionID, { providerID: "google", modelID: "gemini-3.1-pro" })
    await updateConnectedProvidersCache({
      provider: {
        list: async () => ({
          data: {
            connected: ["anthropic", "google", "openai"],
            all: [
              { id: "anthropic", models: {} },
              { id: "google", models: {} },
              { id: "openai", models: {} },
            ],
          },
        }),
      },
    })
    const chain = [
      { providers: ["google"], model: "gemini-3.1-pro" },
      { providers: ["openai"], model: "gpt-5.4" },
    ]
    for (const sessionID of [failedSessionID, unrelatedSessionID]) {
      setSessionFallbackChain(modelFallback, sessionID, chain)
      expect(setPendingModelFallback(modelFallback, sessionID, "sisyphus", "anthropic", "claude-opus-4-6")).toBe(true)
    }

    await runtimeHandler({
      event: {
        type: "session.error",
        properties: {
          sessionID: failedSessionID,
          error: { name: "QuotaExceededError", message: "subscription quota exceeded" },
        },
      },
    })

    expect(getNextFallback(modelFallback, failedSessionID)).toMatchObject({
      providerID: "openai",
      modelID: "gpt-5.4",
    })
    expect(getNextFallback(modelFallback, unrelatedSessionID)).toMatchObject({
      providerID: "google",
      modelID: "gemini-3.1-pro-preview",
    })
  })
})
