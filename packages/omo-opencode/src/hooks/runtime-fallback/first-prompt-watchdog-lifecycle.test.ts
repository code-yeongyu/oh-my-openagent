import { describe, expect, it } from "bun:test"
import type { AutoRetryHelpers } from "./auto-retry"
import { createEventHandler } from "./event-handler"
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

  it("#given the watchdog abort is in flight #when the session is cancelled before abort resolves #then no fallback is dispatched", async () => {
    const sessionID = "session-cancelled-during-watchdog-abort"
    const deps = createDeps()
    const calls = { dispatch: 0 }
    let resolveAbort: ((value: boolean) => void) | undefined
    let notifyAbortStarted: (() => void) | undefined
    const abortStarted = new Promise<void>((resolve) => {
      notifyAbortStarted = resolve
    })
    const abortResult = new Promise<boolean>((resolve) => {
      resolveAbort = resolve
    })
    const helpers: AutoRetryHelpers = {
      abortSessionRequest: async () => {
        deps.internallyAbortedSessions.add(sessionID)
        notifyAbortStarted?.()
        return abortResult
      },
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
    watchdog.onSessionTerminal(sessionID, "session.stop")
    await createEventHandler(deps, helpers)({
      event: { type: "session.stop", properties: { sessionID } },
    })
    resolveAbort?.(true)
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await Promise.resolve()
    }

    expect(calls.dispatch).toBe(0)
    watchdog.dispose()
  })

  it("#given the watchdog abort request is not yet acknowledged #when an abort-shaped session error arrives #then it is external cancellation and no fallback is dispatched", async () => {
    const sessionID = "session-external-abort-during-watchdog-abort"
    const deps = createDeps()
    const calls = { dispatch: 0 }
    let resolveAbort: ((value: boolean) => void) | undefined
    let notifyAbortStarted: (() => void) | undefined
    const abortStarted = new Promise<void>((resolve) => {
      notifyAbortStarted = resolve
    })
    const abortResult = new Promise<boolean>((resolve) => {
      resolveAbort = resolve
    })
    const helpers: AutoRetryHelpers = {
      abortSessionRequest: async () => {
        deps.internallyAbortedSessions.add(sessionID)
        notifyAbortStarted?.()
        return abortResult
      },
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
    watchdog.onSessionTerminal(sessionID, "session.error", true)
    await createEventHandler(deps, helpers)({
      event: {
        type: "session.error",
        properties: { sessionID, error: { name: "MessageAbortedError" } },
      },
    })
    resolveAbort?.(true)
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await Promise.resolve()
    }

    expect(calls.dispatch).toBe(0)
    expect(deps.internallyAbortedSessions.has(sessionID)).toBe(false)
    watchdog.dispose()
  })

  it("#given the watchdog abort is in flight #when OpenCode reports its internal completion and idle events #then the fallback is still dispatched", async () => {
    const sessionID = "session-internal-abort-completes"
    const deps = createDeps()
    const calls = { dispatch: 0 }
    let resolveAbort: ((value: boolean) => void) | undefined
    let notifyAbortStarted: (() => void) | undefined
    const abortStarted = new Promise<void>((resolve) => {
      notifyAbortStarted = resolve
    })
    const abortResult = new Promise<boolean>((resolve) => {
      resolveAbort = resolve
    })
    const helpers: AutoRetryHelpers = {
      abortSessionRequest: async () => {
        deps.internallyAbortedSessions.add(sessionID)
        notifyAbortStarted?.()
        return abortResult
      },
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
    watchdog.onAssistantProgress(sessionID)
    watchdog.onSessionTerminal(sessionID, "session.idle")
    resolveAbort?.(true)
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await Promise.resolve()
    }

    expect(calls.dispatch).toBe(1)
    watchdog.dispose()
  })

  it("#given the watchdog abort request succeeded #when an abort error arrives while fallback dispatch settles #then it remains external cancellation", async () => {
    const sessionID = "session-internal-abort-error"
    const deps = createDeps()
    const calls = { abortSources: [] as string[], dispatch: 0 }
    let resolveAbort: ((value: boolean) => void) | undefined
    let notifyAbortStarted: (() => void) | undefined
    const abortStarted = new Promise<void>((resolve) => {
      notifyAbortStarted = resolve
    })
    const abortResult = new Promise<boolean>((resolve) => {
      resolveAbort = resolve
    })
    let releaseDispatch: (() => void) | undefined
    let notifyDispatchStarted: (() => void) | undefined
    const dispatchStarted = new Promise<void>((resolve) => {
      notifyDispatchStarted = resolve
    })
    const dispatchReleased = new Promise<void>((resolve) => {
      releaseDispatch = resolve
    })
    const helpers: AutoRetryHelpers = {
      abortSessionRequest: async (_abortedSessionID, source) => {
        calls.abortSources.push(source)
        if (source === "first-prompt-watchdog") {
          deps.internallyAbortedSessions.add(sessionID)
          notifyAbortStarted?.()
          return abortResult
        }
        return true
      },
      clearSessionFallbackTimeout: () => {},
      scheduleSessionFallbackTimeout: () => {},
      autoRetryWithFallback: async () => {
        calls.dispatch += 1
        notifyDispatchStarted?.()
        await dispatchReleased
        return { accepted: true, status: "dispatched" }
      },
      resolveAgentForSessionFromContext: async () => AGENT,
      cleanupStaleSessions: () => {},
    }
    const watchdog = createFirstPromptWatchdog(deps, helpers, 1)

    watchdog.onUserMessage(sessionID, PRIMARY_MODEL, AGENT)
    await abortStarted
    resolveAbort?.(true)
    await dispatchStarted
    watchdog.onSessionTerminal(sessionID, "session.error", true)
    await createEventHandler(deps, helpers)({
      event: {
        type: "session.error",
        properties: { sessionID, error: { name: "MessageAbortedError" } },
      },
    })
    releaseDispatch?.()
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await Promise.resolve()
    }

    expect(calls.dispatch).toBe(1)
    expect(calls.abortSources).toEqual(["first-prompt-watchdog", "session.stop"])
    expect(deps.internallyAbortedSessions.has(sessionID)).toBe(false)
    watchdog.dispose()
  })

  it("#given the watchdog abort marker is set #when a non-abort session error arrives #then the watchdog callback is cancelled", async () => {
    const sessionID = "session-provider-error-during-abort"
    const deps = createDeps()
    const calls = { dispatch: 0 }
    let resolveAbort: ((value: boolean) => void) | undefined
    let notifyAbortStarted: (() => void) | undefined
    const abortStarted = new Promise<void>((resolve) => {
      notifyAbortStarted = resolve
    })
    const abortResult = new Promise<boolean>((resolve) => {
      resolveAbort = resolve
    })
    const helpers: AutoRetryHelpers = {
      abortSessionRequest: async () => {
        deps.internallyAbortedSessions.add(sessionID)
        notifyAbortStarted?.()
        return abortResult
      },
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
    watchdog.onSessionTerminal(sessionID, "session.error", false)
    resolveAbort?.(true)
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await Promise.resolve()
    }

    expect(calls.dispatch).toBe(0)
    watchdog.dispose()
  })
})
