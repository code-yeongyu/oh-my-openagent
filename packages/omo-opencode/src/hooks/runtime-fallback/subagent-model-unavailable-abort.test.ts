import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import type { HookDeps, RuntimeFallbackPluginInput } from "./types"
import type { AutoRetryHelpers } from "./auto-retry"
import { subagentSessions } from "../../features/claude-code-session-state"

type MessageUpdateHandlerModule = typeof import("./message-update-handler")

async function importFreshMessageUpdateHandlerModule(): Promise<MessageUpdateHandlerModule> {
  return import(`./message-update-handler?subagent-model-unavailable-${Date.now()}-${Math.random()}`)
}

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
    pluginConfig: {},
    sessionStates: new Map(),
    sessionLastAccess: new Map(),
    sessionRetryInFlight: new Set(),
    sessionAwaitingFallbackResult: new Set(),
    sessionFallbackTimeouts: new Map(),
    sessionStatusRetryKeys: new Map(),
  }
}

function createHelpers(abortCalls: Array<{ sessionID: string; source: string }>): AutoRetryHelpers {
  return {
    abortSessionRequest: async (sessionID: string, source: string) => {
      abortCalls.push({ sessionID, source })
    },
    clearSessionFallbackTimeout: () => {},
    scheduleSessionFallbackTimeout: () => {},
    autoRetryWithFallback: async () => {},
    resolveAgentForSessionFromContext: async () => undefined,
    cleanupStaleSessions: () => {},
  }
}

const MODEL_NOT_FOUND_ERROR = {
  name: "ModelNotFoundError",
  message: "Model gpt-5.6-sol not found for provider openai",
}

const MISSING_API_KEY_ERROR = {
  name: "LoadApiKeyError",
  message: "API key is missing. Set the environment variable for provider openai.",
}

describe("createMessageUpdateHandler subagent model-unavailable abort", () => {
  beforeEach(() => {
    subagentSessions.clear()
  })

  afterEach(() => {
    subagentSessions.clear()
  })

  it("#given a subagent session hits a model-not-found error with no fallback configured #when the assistant error event fires #then the subagent session is aborted so the parent tool call can resolve instead of re-delegating forever", async () => {
    // given
    const { createMessageUpdateHandler } = await importFreshMessageUpdateHandlerModule()
    const sessionID = "session-oracle-subagent"
    subagentSessions.add(sessionID)
    const abortCalls: Array<{ sessionID: string; source: string }> = []
    const deps = createDeps()
    const handler = createMessageUpdateHandler(deps, createHelpers(abortCalls))

    // when
    await handler({ info: { sessionID, role: "assistant", model: "openai/gpt-5.6-sol", error: MODEL_NOT_FOUND_ERROR } })

    // then
    expect(abortCalls).toEqual([
      { sessionID, source: "message.updated.subagent-model-unavailable-no-fallback" },
    ])
  })

  it("#given a subagent session hits a missing-api-key error with no fallback configured #when the assistant error event fires #then the subagent session is aborted", async () => {
    // given
    const { createMessageUpdateHandler } = await importFreshMessageUpdateHandlerModule()
    const sessionID = "session-deep-subagent"
    subagentSessions.add(sessionID)
    const abortCalls: Array<{ sessionID: string; source: string }> = []
    const deps = createDeps()
    const handler = createMessageUpdateHandler(deps, createHelpers(abortCalls))

    // when
    await handler({ info: { sessionID, role: "assistant", model: "openai/gpt-5.6-sol", error: MISSING_API_KEY_ERROR } })

    // then
    expect(abortCalls).toEqual([
      { sessionID, source: "message.updated.subagent-model-unavailable-no-fallback" },
    ])
  })

  it("#given a non-subagent (user) session hits the same model-not-found error #when the assistant error event fires #then the user session is NOT aborted", async () => {
    // given
    const { createMessageUpdateHandler } = await importFreshMessageUpdateHandlerModule()
    const sessionID = "session-user-foreground-model-missing"
    // NOT added to subagentSessions
    const abortCalls: Array<{ sessionID: string; source: string }> = []
    const deps = createDeps()
    const handler = createMessageUpdateHandler(deps, createHelpers(abortCalls))

    // when
    await handler({ info: { sessionID, role: "assistant", model: "openai/gpt-5.6-sol", error: MODEL_NOT_FOUND_ERROR } })

    // then
    expect(abortCalls).toEqual([])
  })

  it("#given a subagent session hits a transient retryable error (rate limit) with no fallback configured #when the assistant error event fires #then the subagent is NOT aborted (transient errors may self-heal)", async () => {
    // given
    const { createMessageUpdateHandler } = await importFreshMessageUpdateHandlerModule()
    const sessionID = "session-rate-limited-subagent-model-test"
    subagentSessions.add(sessionID)
    const abortCalls: Array<{ sessionID: string; source: string }> = []
    const deps = createDeps()
    const handler = createMessageUpdateHandler(deps, createHelpers(abortCalls))

    // when
    await handler({
      info: {
        sessionID,
        role: "assistant",
        model: "openai/gpt-5.6-sol",
        error: {
          name: "RateLimitError",
          message: "rate limit exceeded, retrying in 30s",
        },
      },
    })

    // then
    expect(abortCalls).toEqual([])
  })
})
