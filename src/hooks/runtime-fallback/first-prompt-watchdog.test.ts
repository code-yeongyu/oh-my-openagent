import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import type { HookDeps, RuntimeFallbackPluginInput } from "./types"
import type { AutoRetryHelpers } from "./auto-retry"
import { subagentSessions } from "../../features/claude-code-session-state"
import { createFirstPromptWatchdog } from "./first-prompt-watchdog"

const WATCHDOG_MS = 40
const SAFE_WAIT_AFTER_FIRE_MS = 120
const SAFE_WAIT_BEFORE_FIRE_MS = 15

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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
      retry_on_errors: [429, 503, 529],
      max_fallback_attempts: 3,
      cooldown_seconds: 60,
      timeout_seconds: 30,
      notify_on_fallback: false,
    },
    options: undefined,
    pluginConfig,
    sessionStates: new Map(),
    sessionLastAccess: new Map(),
    sessionRetryInFlight: new Set(),
    sessionAwaitingFallbackResult: new Set(),
    sessionFallbackTimeouts: new Map(),
    sessionStatusRetryKeys: new Map(),
  }
}

interface RecordedCalls {
  abort: Array<{ sessionID: string; source: string }>
  autoRetry: Array<{ sessionID: string; newModel: string; resolvedAgent: string | undefined; source: string }>
}

function createHelpers(calls: RecordedCalls, resolvedAgentName?: string): AutoRetryHelpers {
  return {
    abortSessionRequest: async (sessionID: string, source: string) => {
      calls.abort.push({ sessionID, source })
    },
    clearSessionFallbackTimeout: () => {},
    scheduleSessionFallbackTimeout: () => {},
    autoRetryWithFallback: async (sessionID, newModel, resolvedAgent, source) => {
      calls.autoRetry.push({ sessionID, newModel, resolvedAgent, source })
    },
    resolveAgentForSessionFromContext: async () => resolvedAgentName,
    cleanupStaleSessions: () => {},
  }
}

const AGENT = "sisyphus-junior"
const PRIMARY_MODEL = "openai/gpt-5.4-mini"
const FALLBACK_MODEL = "anthropic/claude-haiku-4-5"
const PLUGIN_CONFIG_WITH_FALLBACK = {
  agents: {
    [AGENT]: {
      model: PRIMARY_MODEL,
      fallback_models: [{ model: FALLBACK_MODEL }],
    },
  },
}

describe("first-prompt-watchdog", () => {
  beforeEach(() => {
    subagentSessions.clear()
  })

  afterEach(() => {
    subagentSessions.clear()
  })

  it("#given a subagent stays silent past the threshold and has a fallback configured #when the watchdog fires #then it aborts the in-flight request and dispatches the fallback model", async () => {
    // given
    const sessionID = "session-silent-subagent"
    subagentSessions.add(sessionID)
    const deps = createDeps(PLUGIN_CONFIG_WITH_FALLBACK)
    const calls: RecordedCalls = { abort: [], autoRetry: [] }
    const helpers = createHelpers(calls, AGENT)
    const watchdog = createFirstPromptWatchdog(deps, helpers, WATCHDOG_MS)

    // when
    watchdog.onUserMessage(sessionID, PRIMARY_MODEL, AGENT)
    await wait(SAFE_WAIT_AFTER_FIRE_MS)

    // then
    expect(calls.abort).toEqual([{ sessionID, source: "first-prompt-watchdog" }])
    expect(calls.autoRetry).toHaveLength(1)
    expect(calls.autoRetry[0].sessionID).toBe(sessionID)
    expect(calls.autoRetry[0].newModel).toBe(FALLBACK_MODEL)
    expect(calls.autoRetry[0].source).toBe("first-prompt-watchdog")

    watchdog.dispose()
  })

  it("#given a subagent produces assistant text before the threshold #when progress is observed #then the watchdog is cancelled and no fallback is dispatched", async () => {
    // given
    const sessionID = "session-makes-progress"
    subagentSessions.add(sessionID)
    const deps = createDeps(PLUGIN_CONFIG_WITH_FALLBACK)
    const calls: RecordedCalls = { abort: [], autoRetry: [] }
    const helpers = createHelpers(calls, AGENT)
    const watchdog = createFirstPromptWatchdog(deps, helpers, WATCHDOG_MS)

    // when
    watchdog.onUserMessage(sessionID, PRIMARY_MODEL, AGENT)
    await wait(SAFE_WAIT_BEFORE_FIRE_MS)
    watchdog.onAssistantProgress(sessionID)
    await wait(SAFE_WAIT_AFTER_FIRE_MS)

    // then
    expect(calls.abort).toEqual([])
    expect(calls.autoRetry).toEqual([])

    watchdog.dispose()
  })

  it("#given the session is not a subagent #when a user message is observed #then the watchdog never arms and nothing fires", async () => {
    // given
    const sessionID = "session-not-a-subagent"
    // NOT added to subagentSessions
    const deps = createDeps(PLUGIN_CONFIG_WITH_FALLBACK)
    const calls: RecordedCalls = { abort: [], autoRetry: [] }
    const helpers = createHelpers(calls, AGENT)
    const watchdog = createFirstPromptWatchdog(deps, helpers, WATCHDOG_MS)

    // when
    watchdog.onUserMessage(sessionID, PRIMARY_MODEL, AGENT)
    await wait(SAFE_WAIT_AFTER_FIRE_MS)

    // then
    expect(calls.abort).toEqual([])
    expect(calls.autoRetry).toEqual([])

    watchdog.dispose()
  })

  it("#given a subagent reaches a terminal session state before the threshold #when onSessionTerminal is called #then the watchdog is cancelled and no fallback is dispatched", async () => {
    // given
    const sessionID = "session-terminated-early"
    subagentSessions.add(sessionID)
    const deps = createDeps(PLUGIN_CONFIG_WITH_FALLBACK)
    const calls: RecordedCalls = { abort: [], autoRetry: [] }
    const helpers = createHelpers(calls, AGENT)
    const watchdog = createFirstPromptWatchdog(deps, helpers, WATCHDOG_MS)

    // when
    watchdog.onUserMessage(sessionID, PRIMARY_MODEL, AGENT)
    await wait(SAFE_WAIT_BEFORE_FIRE_MS)
    watchdog.onSessionTerminal(sessionID)
    await wait(SAFE_WAIT_AFTER_FIRE_MS)

    // then
    expect(calls.abort).toEqual([])
    expect(calls.autoRetry).toEqual([])

    watchdog.dispose()
  })

  it("#given a subagent silent past the threshold with no fallback configured #when the watchdog fires #then it logs but does not abort or dispatch (lets PR #3950 quota-abort path handle it later if an error event arrives)", async () => {
    // given
    const sessionID = "session-no-fallback"
    subagentSessions.add(sessionID)
    const deps = createDeps({}) // empty pluginConfig → no fallback models
    const calls: RecordedCalls = { abort: [], autoRetry: [] }
    const helpers = createHelpers(calls, AGENT)
    const watchdog = createFirstPromptWatchdog(deps, helpers, WATCHDOG_MS)

    // when
    watchdog.onUserMessage(sessionID, PRIMARY_MODEL, AGENT)
    await wait(SAFE_WAIT_AFTER_FIRE_MS)

    // then
    expect(calls.abort).toEqual([])
    expect(calls.autoRetry).toEqual([])

    watchdog.dispose()
  })
})
