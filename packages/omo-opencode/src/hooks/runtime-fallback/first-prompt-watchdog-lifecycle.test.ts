import { describe, expect, it } from "bun:test"
import type { AutoRetryHelpers } from "./auto-retry"
import { createEventHandler } from "./event-handler"
import { createFirstPromptWatchdog } from "./first-prompt-watchdog"
import {
  AGENT,
  createDeps as createBaseDeps,
  PLUGIN_CONFIG_WITH_FALLBACK,
  PRIMARY_MODEL,
} from "./first-prompt-watchdog-test-helpers"

function createDeps() {
  return createBaseDeps(PLUGIN_CONFIG_WITH_FALLBACK)
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

})
