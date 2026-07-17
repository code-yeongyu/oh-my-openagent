import { describe, expect, it } from "bun:test"
import type { AutoRetryHelpers } from "./auto-retry"
import { createAbortSessionRequest } from "./auto-retry-abort"
import { createEventHandler } from "./event-handler"
import { createFallbackState } from "./fallback-state"
import { createFirstPromptWatchdog } from "./first-prompt-watchdog"
import { fireFirstPromptWatchdog } from "./first-prompt-watchdog-fire"
import {
  AGENT,
  createDeps,
  installFakeTimers,
  PLUGIN_CONFIG_WITH_FALLBACK,
  PRIMARY_MODEL,
} from "./first-prompt-watchdog-test-helpers"
import { createSessionStatusHandler } from "./session-status-handler"

function createDeferred<T>(): {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
} {
  let resolvePromise: ((value: T) => void) | undefined
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })
  return {
    promise,
    resolve: (value) => resolvePromise?.(value),
  }
}

describe("runtime-fallback abort wire ordering", () => {
  it("#given OpenCode publishes the watchdog abort before its HTTP response #when the event is observed #then fallback ownership survives and dispatch continues", async () => {
    const sessionID = "session-watchdog-event-before-response"
    const deps = createDeps(PLUGIN_CONFIG_WITH_FALLBACK)
    const abortResponse = createDeferred<unknown>()
    const abortStarted = createDeferred<void>()
    const calls = { dispatch: 0 }
    deps.ctx.client.session.abort = async () => {
      abortStarted.resolve()
      return abortResponse.promise
    }
    const helpers: AutoRetryHelpers = {
      abortSessionRequest: createAbortSessionRequest(deps),
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
    const eventHandler = createEventHandler(deps, helpers)

    watchdog.onUserMessage(sessionID, PRIMARY_MODEL, AGENT)
    await abortStarted.promise
    const decision = watchdog.onSessionTerminal(sessionID, "session.error", true)
    if (decision?.kind !== "consume-terminal") {
      await eventHandler({
        event: {
          type: "session.error",
          properties: { sessionID, error: { name: "MessageAbortedError" } },
        },
      })
    }
    abortResponse.resolve({})
    for (let attempt = 0; attempt < 10; attempt += 1) await Promise.resolve()

    expect(decision).toEqual({ kind: "consume-terminal", sessionID })
    expect(calls.dispatch).toBe(1)
    watchdog.dispose()
  })

  it("#given overlapping internal abort callers for one session #when OpenCode emits one internal terminal #then the next abort event remains a genuine cancellation", async () => {
    const sessionID = "session-coalesced-overlapping-aborts"
    const deps = createDeps(PLUGIN_CONFIG_WITH_FALLBACK)
    const abortResponse = createDeferred<unknown>()
    let abortCalls = 0
    deps.ctx.client.session.abort = async () => {
      abortCalls += 1
      return abortResponse.promise
    }
    const abortSessionRequest = createAbortSessionRequest(deps)
    const helpers: AutoRetryHelpers = {
      abortSessionRequest,
      clearSessionFallbackTimeout: () => {},
      scheduleSessionFallbackTimeout: () => {},
      autoRetryWithFallback: async () => ({
        accepted: true,
        status: "dispatched",
      }),
      resolveAgentForSessionFromContext: async () => AGENT,
      cleanupStaleSessions: () => {},
    }
    const eventHandler = createEventHandler(deps, helpers)
    const firstAbort = abortSessionRequest(sessionID, "session.status.retry-signal")
    const secondAbort = abortSessionRequest(sessionID, "first-prompt-watchdog")
    abortResponse.resolve({})
    expect(await Promise.all([firstAbort, secondAbort])).toEqual([true, false])
    expect(abortCalls).toBe(1)

    const state = createFallbackState(PRIMARY_MODEL)
    state.attemptCount = 1
    deps.sessionStates.set(sessionID, state)
    await eventHandler({
      event: {
        type: "session.error",
        properties: { sessionID, error: { name: "MessageAbortedError" } },
      },
    })
    expect(deps.sessionStates.has(sessionID)).toBe(true)

    await eventHandler({
      event: {
        type: "session.error",
        properties: { sessionID, error: { name: "MessageAbortedError" } },
      },
    })
    expect(deps.sessionStates.get(sessionID)?.attemptCount).toBe(0)
  })

  it("#given status fallback and watchdog share one abort #when the terminal arrives during status dispatch #then the status fallback remains authoritative", async () => {
    const sessionID = "session-status-watchdog-overlap"
    const deps = createDeps(PLUGIN_CONFIG_WITH_FALLBACK)
    const abortResponse = createDeferred<unknown>()
    const abortStarted = createDeferred<void>()
    const statusDispatch = createDeferred<{ readonly accepted: true; readonly status: "dispatched" }>()
    const dispatchSources: string[] = []
    deps.ctx.client.session.abort = async () => {
      abortStarted.resolve()
      return abortResponse.promise
    }
    const helpers: AutoRetryHelpers = {
      abortSessionRequest: createAbortSessionRequest(deps),
      clearSessionFallbackTimeout: () => {},
      scheduleSessionFallbackTimeout: () => {},
      autoRetryWithFallback: async (_sessionID, _newModel, _resolvedAgent, source) => {
        dispatchSources.push(source)
        if (source === "session.status") {
          deps.sessionRetryInFlight.add(sessionID)
          return statusDispatch.promise
        }
        if (deps.sessionRetryInFlight.has(sessionID)) {
          return { accepted: false, status: "blocked", reason: "retry already in flight" }
        }
        return { accepted: true, status: "dispatched" }
      },
      resolveAgentForSessionFromContext: async () => AGENT,
      cleanupStaleSessions: () => {},
    }
    const eventHandler = createEventHandler(deps, helpers)
    const statusHandler = createSessionStatusHandler(deps, helpers)

    const statusPromise = statusHandler({
      sessionID,
      model: PRIMARY_MODEL,
      agent: AGENT,
      status: {
        type: "retry",
        attempt: 1,
        message: "Provider unavailable, retrying in 1s attempt #1",
      },
    })
    await abortStarted.promise
    const watchdogPromise = fireFirstPromptWatchdog({
      deps,
      helpers,
      watchdogMs: 1,
      sessionID,
      model: PRIMARY_MODEL,
      agent: AGENT,
      wasSubagent: false,
      isLifecycleCurrent: () => true,
      isSessionCurrent: () => true,
      recordAbortProvenance: () => () => {},
      markAbortResponsePending: () => {},
      clearAbortResponsePending: () => {},
    })
    abortResponse.resolve({})
    for (let attempt = 0; attempt < 10 && dispatchSources.length < 2; attempt += 1) {
      await Promise.resolve()
    }
    await watchdogPromise

    await eventHandler({
      event: {
        type: "session.error",
        properties: { sessionID, error: { name: "MessageAbortedError" } },
      },
    })

    expect(deps.sessionStates.get(sessionID)?.currentModel).toBe("anthropic/claude-haiku-4-5")
    expect(deps.sessionStates.get(sessionID)?.attemptCount).toBe(1)
    expect(deps.sessionRetryInFlight.has(sessionID)).toBe(true)

    statusDispatch.resolve({ accepted: true, status: "dispatched" })
    await statusPromise
    deps.sessionRetryInFlight.delete(sessionID)
  })

  it("#given a status fallback replaces the silent request #when the original watchdog deadline passes #then the accepted fallback is not aborted or advanced", async () => {
    const fakeTimers = installFakeTimers()
    const sessionID = "session-status-cancels-stale-watchdog"
    const secondFallback = "google/gemini-3-flash"
    const deps = createDeps({
      ...PLUGIN_CONFIG_WITH_FALLBACK,
      agents: {
        [AGENT]: {
          model: PRIMARY_MODEL,
          fallback_models: [
            { model: "anthropic/claude-haiku-4-5" },
            { model: secondFallback },
          ],
        },
      },
    })
    const dispatchSources: string[] = []
    const helpers: AutoRetryHelpers = {
      abortSessionRequest: createAbortSessionRequest(deps),
      clearSessionFallbackTimeout: () => {},
      scheduleSessionFallbackTimeout: () => {},
      autoRetryWithFallback: async (_sessionID, _newModel, _resolvedAgent, source) => {
        dispatchSources.push(source)
        return { accepted: true, status: "dispatched" }
      },
      resolveAgentForSessionFromContext: async () => AGENT,
      cleanupStaleSessions: () => {},
    }
    const watchdog = createFirstPromptWatchdog(deps, helpers, 100)
    const statusHandler = createSessionStatusHandler(
      deps,
      helpers,
      (ownedSessionID) => watchdog.onFallbackOwnershipTransferred(ownedSessionID),
    )

    try {
      watchdog.onUserMessage(sessionID, PRIMARY_MODEL, AGENT)
      await fakeTimers.advanceBy(40)

      await statusHandler({
        sessionID,
        model: PRIMARY_MODEL,
        agent: AGENT,
        status: {
          type: "retry",
          attempt: 1,
          message: "Provider unavailable, retrying in 1s attempt #1",
        },
      })
      watchdog.onAssistantProgress(sessionID)
      watchdog.onSessionTerminal(sessionID, "session.idle")
      await fakeTimers.advanceBy(100)

      expect(dispatchSources).toEqual(["session.status"])
      expect(deps.sessionStates.get(sessionID)?.currentModel).toBe("anthropic/claude-haiku-4-5")
      expect(deps.sessionStates.get(sessionID)?.attemptCount).toBe(1)
    } finally {
      watchdog.dispose()
      fakeTimers.restore()
    }
  })
})
