import { describe, expect, it } from "bun:test"
import type { HookDeps, RuntimeFallbackPluginInput } from "./types"
import type { AutoRetryHelpers } from "./auto-retry"
import { createEventHandler } from "./event-handler"

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

function createDeps(pluginConfig: Record<string, unknown> = {}): HookDeps {
  return {
    ctx: createContext(),
    config: {
      enabled: true,
      retry_on_errors: [402, 429, 503, 529],
      max_fallback_attempts: 3,
      cooldown_seconds: 60,
      timeout_seconds: 30,
      notify_on_fallback: false,
      restore_primary_after_cooldown: false,
    },
    options: undefined,
    pluginConfig: pluginConfig as never,
    sessionStates: new Map(),
    sessionLastAccess: new Map(),
    sessionRetryInFlight: new Set(),
    sessionAwaitingFallbackResult: new Set(),
    sessionFallbackTimeouts: new Map(),
    sessionStatusRetryKeys: new Map(),
    internallyAbortedSessions: new Set(),
  }
}

function createHelpers(
  dispatchCalls: Array<{ sessionID: string; newModel: string; source: string }>,
): AutoRetryHelpers {
  return {
    abortSessionRequest: async () => {},
    clearSessionFallbackTimeout: () => {},
    scheduleSessionFallbackTimeout: () => {},
    autoRetryWithFallback: async (sessionID: string, newModel: string, _agent?: string, source?: string) => {
      dispatchCalls.push({ sessionID, newModel, source: source ?? "" })
      return { accepted: true, status: "dispatched" }
    },
    resolveAgentForSessionFromContext: async () => "sisyphus-junior",
    cleanupStaleSessions: () => {},
  }
}

// The terminal-quota 402 shape after a minimax-coding-plan / LiteLLM Payment
// Required kills the stream: OpenCode surfaces the dead request as an
// abort-classified error while the payload still carries the 402 status
// (#6677 classifies this shape as non-retryable "abort"). The session.error
// path must treat it as quota exhaustion and dispatch a session-stable
// fallback, never silently drop it like a user cancellation.
const TERMINAL_402_ABORT = {
  name: "MessageAbortedError",
  data: {
    statusCode: 402,
    isRetryable: false,
    message: "Terminal quota or billing limit reached for the requested LiteLLM model handle.",
  },
}

const FALLBACK_PLUGIN_CONFIG = {
  agents: {
    "sisyphus-junior": {
      model: "litellm/kimi-k3",
      fallback_models: ["litellm/gpt-5.6-sol", "litellm/glm-5.2"],
    },
  },
}

describe("createEventHandler terminal-quota-402 session-stable fallback", () => {
  it("#given a session hits a terminal-quota 402 abort reported via session.error #when the event handler processes it #then exactly ONE session-stable fallback dispatch happens on the same session instead of dropping the session", async () => {
    // given
    const sessionID = "ses_xx-sisyphus-junior-terminal402-session-error"
    const dispatchCalls: Array<{ sessionID: string; newModel: string; source: string }> = []
    const deps = createDeps(FALLBACK_PLUGIN_CONFIG)
    const handler = createEventHandler(deps, createHelpers(dispatchCalls))

    // when
    await handler({
      event: {
        type: "session.error",
        properties: { sessionID, error: TERMINAL_402_ABORT },
      },
    })

    // then
    expect(dispatchCalls).toHaveLength(1)
    expect(dispatchCalls[0].sessionID).toBe(sessionID) // session-stable: same session, no second create
    expect(dispatchCalls[0].newModel).toBe("litellm/gpt-5.6-sol") // first fallback model
    expect(dispatchCalls[0].source).toBe("session.error")
  })

  it("#given a genuine user abort WITHOUT a 402 status #when session.error fires #then NO fallback dispatch happens (cancellation semantics preserved)", async () => {
    // given
    const sessionID = "ses_xx-sisyphus-junior-userabort-session-error"
    const dispatchCalls: Array<{ sessionID: string; newModel: string; source: string }> = []
    const deps = createDeps(FALLBACK_PLUGIN_CONFIG)
    const handler = createEventHandler(deps, createHelpers(dispatchCalls))

    // when
    await handler({
      event: {
        type: "session.error",
        properties: {
          sessionID,
          error: { name: "MessageAbortedError", message: "The user aborted this request." },
        },
      },
    })

    // then
    expect(dispatchCalls).toEqual([])
  })

  it("#given a session hits a terminal-quota 402 abort but resolves NO fallback models #when session.error fires #then NO fallback dispatch happens", async () => {
    // given
    const sessionID = "ses_xx-sisyphus-junior-nofallback-session-error"
    const dispatchCalls: Array<{ sessionID: string; newModel: string; source: string }> = []
    const deps = createDeps({}) // no agents/fallback config
    const handler = createEventHandler(deps, createHelpers(dispatchCalls))

    // when
    await handler({
      event: {
        type: "session.error",
        properties: { sessionID, error: TERMINAL_402_ABORT },
      },
    })

    // then
    expect(dispatchCalls).toEqual([])
  })
})
