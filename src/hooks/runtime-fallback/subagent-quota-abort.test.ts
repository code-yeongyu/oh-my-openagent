import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import type { HookDeps, RuntimeFallbackPluginInput } from "./types"
import type { AutoRetryHelpers } from "./auto-retry"
import { subagentSessions } from "../../features/claude-code-session-state"

type MessageUpdateHandlerModule = typeof import("./message-update-handler")

async function importFreshMessageUpdateHandlerModule(): Promise<MessageUpdateHandlerModule> {
  return import(`./message-update-handler?subagent-quota-${Date.now()}-${Math.random()}`)
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

const QUOTA_ERROR = {
  name: "QuotaExceededError",
  message: "You exceeded your current quota. Please check your plan and billing details.",
}

const QUOTA_INFO = {
  role: "assistant",
  model: "openai/gpt-5.5",
  error: QUOTA_ERROR,
}

describe("createMessageUpdateHandler subagent quota abort", () => {
  beforeEach(() => {
    subagentSessions.clear()
  })

  afterEach(() => {
    subagentSessions.clear()
  })

  it("#given a subagent session hits a quota error with no fallback configured #when the assistant error event fires #then the subagent session is aborted so the parent tool call can resolve", async () => {
    // given
    const { createMessageUpdateHandler } = await importFreshMessageUpdateHandlerModule()
    const sessionID = "session-momus-subagent"
    subagentSessions.add(sessionID)
    const abortCalls: Array<{ sessionID: string; source: string }> = []
    const deps = createDeps()
    const handler = createMessageUpdateHandler(deps, createHelpers(abortCalls))

    // when
    await handler({ info: { sessionID, ...QUOTA_INFO } })

    // then
    expect(abortCalls).toEqual([
      { sessionID, source: "message.updated.subagent-quota-no-fallback" },
    ])
  })

  it("#given a non-subagent (user) session hits the same quota error #when the assistant error event fires #then the user session is NOT aborted", async () => {
    // given
    const { createMessageUpdateHandler } = await importFreshMessageUpdateHandlerModule()
    const sessionID = "session-user-foreground"
    // NOT added to subagentSessions
    const abortCalls: Array<{ sessionID: string; source: string }> = []
    const deps = createDeps()
    const handler = createMessageUpdateHandler(deps, createHelpers(abortCalls))

    // when
    await handler({ info: { sessionID, ...QUOTA_INFO } })

    // then
    expect(abortCalls).toEqual([])
  })

  it("#given a subagent session hits a non-quota retryable error (rate limit) with no fallback configured #when the assistant error event fires #then the subagent is NOT aborted (preserves existing behavior for other error classes)", async () => {
    // given
    const { createMessageUpdateHandler } = await importFreshMessageUpdateHandlerModule()
    const sessionID = "session-rate-limited-subagent"
    subagentSessions.add(sessionID)
    const abortCalls: Array<{ sessionID: string; source: string }> = []
    const deps = createDeps()
    const handler = createMessageUpdateHandler(deps, createHelpers(abortCalls))

    // when
    await handler({
      info: {
        sessionID,
        role: "assistant",
        model: "openai/gpt-5.5",
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
