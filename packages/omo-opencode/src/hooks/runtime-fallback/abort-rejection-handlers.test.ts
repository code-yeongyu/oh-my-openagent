import { afterEach, describe, expect, it } from "bun:test"
import type { AutoRetryHelpers } from "./auto-retry"
import { createFallbackState } from "./fallback-state"
import { createMessageUpdateHandler } from "./message-update-handler"
import { createSessionStatusHandler } from "./session-status-handler"
import type { HookDeps, RuntimeFallbackPluginInput } from "./types"
import { SessionCategoryRegistry } from "../../shared/session-category-registry"

const FALLBACK_MODEL = "google/gemini-2.5-pro"

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
      retry_on_errors: [429, 503, 529],
      max_fallback_attempts: 4,
      cooldown_seconds: 60,
      timeout_seconds: 30,
      notify_on_fallback: false,
      restore_primary_after_cooldown: false,
    },
    options: undefined,
    pluginConfig: {
      categories: {
        test: { fallback_models: [FALLBACK_MODEL] },
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

function createRejectingHelpers(operations: string[]): AutoRetryHelpers {
  return {
    abortSessionRequest: async (_sessionID: string, source: string) => {
      operations.push(`abort:${source}`)
      return false
    },
    clearSessionFallbackTimeout: () => {},
    scheduleSessionFallbackTimeout: () => {},
    autoRetryWithFallback: async (_sessionID: string, model: string) => {
      operations.push(`retry:${model}`)
      return { accepted: true, status: "dispatched" }
    },
    resolveAgentForSessionFromContext: async () => undefined,
    cleanupStaleSessions: () => {},
  }
}

describe("runtime fallback abort rejection", () => {
  afterEach(() => {
    SessionCategoryRegistry.clear()
  })

  it("#given a message retry signal while a retry is active #when abort is rejected #then ownership and the active retry are preserved", async () => {
    const sessionID = "message-retry-abort-rejected"
    const operations: string[] = []
    const deps = createDeps()
    deps.sessionRetryInFlight.add(sessionID)
    SessionCategoryRegistry.register(sessionID, "test")
    const handler = createMessageUpdateHandler(deps, createRejectingHelpers(operations))

    await handler({
      sessionID,
      info: {
        role: "assistant",
        model: "openai/gpt-5.4",
        message: "All credentials are cooling down, retrying in 30 seconds",
        error: { name: "ProviderRateLimitError", message: "rate limit" },
      },
    })

    expect(operations).toEqual(["abort:message.updated.retry-signal"])
    expect(deps.sessionRetryInFlight.has(sessionID)).toBe(true)
    expect(deps.sessionStates.has(sessionID)).toBe(false)
  })

  it("#given a quota error with a fallback #when abort is rejected #then no replacement request is dispatched", async () => {
    const sessionID = "message-quota-abort-rejected"
    const operations: string[] = []
    const deps = createDeps()
    SessionCategoryRegistry.register(sessionID, "test")
    const handler = createMessageUpdateHandler(deps, createRejectingHelpers(operations))

    await handler({
      sessionID,
      info: {
        role: "assistant",
        model: "openai/gpt-5.4",
        error: {
          name: "ProviderRateLimitError",
          message: "The usage limit has been reached for this model.",
        },
      },
    })

    expect(operations).toEqual(["abort:message.updated.quota-fallback"])
    expect(deps.sessionStates.has(sessionID)).toBe(false)
  })

  it("#given a session retry signal while a retry is active #when abort is rejected #then the active retry remains authoritative", async () => {
    const sessionID = "status-active-abort-rejected"
    const operations: string[] = []
    const deps = createDeps()
    deps.sessionRetryInFlight.add(sessionID)
    SessionCategoryRegistry.register(sessionID, "test")
    const handler = createSessionStatusHandler(
      deps,
      createRejectingHelpers(operations),
      deps.sessionStatusRetryKeys,
    )

    await handler({
      sessionID,
      model: "openai/gpt-5.4",
      status: { type: "retry", attempt: 2, message: "rate limit, retrying in 30 seconds" },
    })

    expect(operations).toEqual(["abort:session.status.retry-signal"])
    expect(deps.sessionRetryInFlight.has(sessionID)).toBe(true)
    expect(deps.sessionStates.has(sessionID)).toBe(false)
  })

  it("#given a pending fallback and a newer session retry signal #when abort is rejected #then pending ownership is preserved", async () => {
    const sessionID = "status-pending-abort-rejected"
    const operations: string[] = []
    const deps = createDeps()
    const state = createFallbackState("openai/primary")
    state.currentModel = "openai/gpt-5.4"
    state.pendingFallbackModel = "openai/gpt-5.4"
    deps.sessionStates.set(sessionID, state)
    SessionCategoryRegistry.register(sessionID, "test")
    const handler = createSessionStatusHandler(
      deps,
      createRejectingHelpers(operations),
      deps.sessionStatusRetryKeys,
    )

    await handler({
      sessionID,
      model: "openai/gpt-5.4",
      status: { type: "retry", attempt: 2, message: "rate limit, retrying in 30 seconds" },
    })

    expect(operations).toEqual(["abort:session.status.retry-signal"])
    expect(state.currentModel).toBe("openai/gpt-5.4")
    expect(state.pendingFallbackModel).toBe("openai/gpt-5.4")
  })
})
