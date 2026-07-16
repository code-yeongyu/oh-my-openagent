import { describe, expect, it } from "bun:test"
import type { AutoRetryHelpers } from "./auto-retry"
import { createFirstPromptWatchdog } from "./first-prompt-watchdog"
import type { HookDeps, RuntimeFallbackPluginInput } from "./types"

const AGENT = "sisyphus-junior"
const PRIMARY_MODEL = "openai/gpt-5.4-mini"

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
    pluginConfig: {
      agents: {
        [AGENT]: {
          model: PRIMARY_MODEL,
          fallback_models: [{ model: "anthropic/claude-haiku-4-5" }],
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

describe("first-prompt watchdog lifecycle", () => {
  it("#given agent resolution is in flight #when the watchdog is disposed #then the stale callback cannot abort, dispatch, or recreate session state", async () => {
    const sessionID = "session-disposed-during-resolution"
    const deps = createDeps()
    const calls = { abort: 0, dispatch: 0 }
    let resolveAgent: ((agent: string | undefined) => void) | undefined
    const resolutionStarted = new Promise<void>((resolve) => {
      resolveAgent = (agent) => {
        resolve(agent)
      }
    })
    let notifyResolutionStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      notifyResolutionStarted = resolve
    })
    const helpers: AutoRetryHelpers = {
      abortSessionRequest: async () => {
        calls.abort += 1
        return true
      },
      clearSessionFallbackTimeout: () => {},
      scheduleSessionFallbackTimeout: () => {},
      autoRetryWithFallback: async () => {
        calls.dispatch += 1
        return { accepted: true, status: "dispatched" }
      },
      resolveAgentForSessionFromContext: async () => {
        notifyResolutionStarted?.()
        return resolutionStarted.then(() => AGENT)
      },
      cleanupStaleSessions: () => {},
    }
    const watchdog = createFirstPromptWatchdog(deps, helpers, 1)

    watchdog.onUserMessage(sessionID, PRIMARY_MODEL, AGENT)
    await started
    watchdog.dispose()
    resolveAgent?.(AGENT)
    await resolutionStarted
    await Promise.resolve()
    await Promise.resolve()

    expect(calls.abort).toBe(0)
    expect(calls.dispatch).toBe(0)
    expect(deps.sessionStates.has(sessionID)).toBe(false)
    expect(deps.sessionLastAccess.has(sessionID)).toBe(false)
  })

  it("#given abort is in flight #when the watchdog is disposed and parent state is cleared #then the stale callback cannot dispatch or recreate cleared state", async () => {
    const sessionID = "session-disposed-during-abort"
    const deps = createDeps()
    const calls = { dispatch: 0 }
    let resolveAbort: ((value: boolean) => void) | undefined
    const abortStarted = new Promise<void>((resolve) => {
      const abortResult = new Promise<boolean>((resolveResult) => {
        resolveAbort = resolveResult
      })
      deps.ctx.client.session.abort = async () => {
        resolve()
        return abortResult
      }
    })
    const helpers: AutoRetryHelpers = {
      abortSessionRequest: async () => deps.ctx.client.session.abort({ path: { id: sessionID } }).then(() => true),
      clearSessionFallbackTimeout: () => {},
      scheduleSessionFallbackTimeout: () => {},
      autoRetryWithFallback: async () => {
        calls.dispatch += 1
        return { accepted: true, status: "dispatched" }
      },
      resolveAgentForSessionFromContext: async () => AGENT,
      cleanupStaleSessions: () => {},
    }
    const watchdog = createFirstPromptWatchdog(deps, helpers, 1)

    watchdog.onUserMessage(sessionID, PRIMARY_MODEL, AGENT)
    await abortStarted
    watchdog.dispose()
    deps.sessionStates.clear()
    deps.sessionLastAccess.clear()
    resolveAbort?.(true)
    await Promise.resolve()
    await Promise.resolve()

    expect(calls.dispatch).toBe(0)
    expect(deps.sessionStates.has(sessionID)).toBe(false)
    expect(deps.sessionLastAccess.has(sessionID)).toBe(false)
  })
})
