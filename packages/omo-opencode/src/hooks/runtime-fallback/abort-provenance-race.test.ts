import { describe, expect, it } from "bun:test"
import type { AutoRetryHelpers } from "./auto-retry"
import { createEventHandler } from "./event-handler"
import { createFallbackState } from "./fallback-state"
import { createMessageUpdateHandler } from "./message-update-handler"
import type { HookDeps, RuntimeFallbackPluginInput } from "./types"

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

function createHelpers(): AutoRetryHelpers {
  return {
    abortSessionRequest: async () => true,
    clearSessionFallbackTimeout: () => {},
    scheduleSessionFallbackTimeout: () => {},
    autoRetryWithFallback: async () => ({ accepted: true, status: "dispatched" }),
    resolveAgentForSessionFromContext: async () => undefined,
    cleanupStaleSessions: () => {},
  }
}

describe("runtime-fallback abort provenance", () => {
  it("#given an internal fallback user update precedes its delayed abort event #when both events are handled #then retry state remains owned by the internal abort", async () => {
    const sessionID = "session-delayed-internal-abort"
    const deps = createDeps()
    const state = createFallbackState("openai/primary")
    state.currentModel = "openai/fallback"
    state.fallbackIndex = 0
    state.attemptCount = 1
    state.pendingFallbackModel = "openai/fallback"
    deps.sessionStates.set(sessionID, state)
    deps.sessionAwaitingFallbackResult.add(sessionID)
    deps.internallyAbortedSessions.add(sessionID)
    const helpers = createHelpers()
    const messageHandler = createMessageUpdateHandler(deps, helpers)
    const eventHandler = createEventHandler(deps, helpers)

    await messageHandler({
      sessionID,
      info: { role: "user", model: "openai/fallback" },
      parts: [{ type: "text", text: "original user prompt" }],
    })
    await eventHandler({
      event: {
        type: "session.error",
        properties: { sessionID, error: { name: "MessageAbortedError" } },
      },
    })

    expect(deps.sessionStates.get(sessionID)?.currentModel).toBe("openai/fallback")
    expect(deps.sessionStates.get(sessionID)?.attemptCount).toBe(1)
    expect(deps.internallyAbortedSessions.has(sessionID)).toBe(false)
  })
})
