import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import type { HookDeps, RuntimeFallbackPluginInput } from "./types"
import type { AutoRetryHelpers } from "./auto-retry"
import { subagentSessions } from "../../features/claude-code-session-state"

type MessageUpdateHandlerModule = typeof import("./message-update-handler")

async function importFreshMessageUpdateHandlerModule(): Promise<MessageUpdateHandlerModule> {
  return import(`./message-update-handler?terminal-402-${Date.now()}-${Math.random()}`)
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
    resolveAgentForSessionFromContext: async () => undefined,
    cleanupStaleSessions: () => {},
  }
}

// The terminal-quota-402 abort shape after #6677's abort classification lands:
// the classifier returns "abort" (here simulated via the AbortError name, since
// this base's message-based quota branch still classifies the 402 as
// quota_exceeded) AND the status code is 402. The hook must fall through the
// `!isRetryableError` early-return and dispatch exactly ONE session-stable
// fallback (autoRetryWithFallback on the SAME session), never a second session.
const TERMINAL_402_ABORT = {
  name: "AbortError",
  data: {
    statusCode: 402,
    isRetryable: false,
    message: "Terminal quota or billing limit reached for the requested LiteLLM model handle.",
  },
}

const TERMINAL_402_INFO = {
  role: "assistant",
  model: "openai/gpt-5.5",
  error: TERMINAL_402_ABORT,
}

const FALLBACK_PLUGIN_CONFIG = {
  agents: {
    "sisyphus-junior": {
      model: "litellm/kimi-k3",
      fallback_models: ["litellm/gpt-5.6-sol", "litellm/glm-5.2"],
    },
  },
}

describe("createMessageUpdateHandler terminal-quota-402 session-stable fallback", () => {
  beforeEach(() => {
    subagentSessions.clear()
  })

  afterEach(() => {
    subagentSessions.clear()
  })

  it("#given a session hits a terminal-quota 402 abort and resolves fallback models #when the assistant error event fires #then exactly ONE session-stable fallback dispatch happens on the same session", async () => {
    // given
    const { createMessageUpdateHandler } = await importFreshMessageUpdateHandlerModule()
    const sessionID = "ses_xx-sisyphus-junior-terminal402"
    const dispatchCalls: Array<{ sessionID: string; newModel: string; source: string }> = []
    const deps = createDeps(FALLBACK_PLUGIN_CONFIG)
    const handler = createMessageUpdateHandler(deps, createHelpers(dispatchCalls))

    // when
    await handler({ info: { sessionID, ...TERMINAL_402_INFO } })

    // then
    expect(dispatchCalls).toHaveLength(1)
    expect(dispatchCalls[0].sessionID).toBe(sessionID) // session-stable: same session, no second create
    expect(dispatchCalls[0].newModel).toBe("litellm/gpt-5.6-sol") // first fallback model
  })

  it("#given a session hits an abort WITHOUT a 402 status (user abort) #when the assistant error event fires #then NO fallback dispatch happens (the new branch only opens for abort + 402)", async () => {
    // given
    const { createMessageUpdateHandler } = await importFreshMessageUpdateHandlerModule()
    const sessionID = "ses_xx-sisyphus-junior-userabort"
    const dispatchCalls: Array<{ sessionID: string; newModel: string; source: string }> = []
    const deps = createDeps(FALLBACK_PLUGIN_CONFIG)
    const handler = createMessageUpdateHandler(deps, createHelpers(dispatchCalls))

    // when
    await handler({
      info: {
        sessionID,
        role: "assistant",
        model: "openai/gpt-5.5",
        error: { name: "MessageAbortedError", message: "The user aborted this request." },
      },
    })

    // then
    expect(dispatchCalls).toEqual([])
  })

  it("#given a session hits a terminal-quota 402 abort but resolves NO fallback models #when the assistant error event fires #then NO fallback dispatch happens", async () => {
    // given
    const { createMessageUpdateHandler } = await importFreshMessageUpdateHandlerModule()
    const sessionID = "ses_xx-sisyphus-junior-nofallback"
    const dispatchCalls: Array<{ sessionID: string; newModel: string; source: string }> = []
    const deps = createDeps({}) // no agents/fallback config
    const handler = createMessageUpdateHandler(deps, createHelpers(dispatchCalls))

    // when
    await handler({ info: { sessionID, ...TERMINAL_402_INFO } })

    // then
    expect(dispatchCalls).toEqual([])
  })
})