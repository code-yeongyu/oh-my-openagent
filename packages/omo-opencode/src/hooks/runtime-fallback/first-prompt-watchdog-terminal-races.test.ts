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

describe("first-prompt watchdog terminal races", () => {
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
    expect(watchdog.onSessionTerminal(sessionID, "session.error", true)).toEqual({
      kind: "inspect-terminal",
      sessionID,
    })
    expect(watchdog.resolveDeferredTerminal(sessionID, false)).toEqual({
      kind: "resolve-terminal",
      sessionID,
    })
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
