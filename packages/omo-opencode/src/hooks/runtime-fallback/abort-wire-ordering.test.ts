import { describe, expect, it } from "bun:test"
import type { AutoRetryHelpers } from "./auto-retry"
import { createAbortSessionRequest } from "./auto-retry-abort"
import { createEventHandler } from "./event-handler"
import { createFallbackState } from "./fallback-state"
import { createFirstPromptWatchdog } from "./first-prompt-watchdog"
import { AGENT, createDeps, PLUGIN_CONFIG_WITH_FALLBACK, PRIMARY_MODEL } from "./first-prompt-watchdog-test-helpers"

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
    expect(await Promise.all([firstAbort, secondAbort])).toEqual([true, true])
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
})
