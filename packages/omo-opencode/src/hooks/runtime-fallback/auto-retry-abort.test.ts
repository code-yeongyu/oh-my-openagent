import { afterEach, describe, expect, test } from "bun:test"

import { releaseAllPromptAsyncReservationsForTesting } from "../../shared/prompt-async-gate"
import { getPromptReservation, setPromptReservation } from "../../shared/prompt-async-gate/reservations"
import { createAbortSessionRequest } from "./auto-retry-abort"
import type { HookDeps, RuntimeFallbackPluginInput } from "./types"

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
      timeout_seconds: 0,
      notify_on_fallback: false,
    },
    options: undefined,
    pluginConfig: undefined,
    sessionStates: new Map(),
    sessionLastAccess: new Map(),
    sessionRetryInFlight: new Set(),
    sessionAwaitingFallbackResult: new Set(),
    sessionFallbackTimeouts: new Map(),
    sessionStatusRetryKeys: new Map(),
    internallyAbortedSessions: new Set(),
  }
}

function reserveSession(sessionID: string, source: string): void {
  setPromptReservation(sessionID, {
    source,
    dedupeKey: "in-flight-stream",
    reservedAt: Date.now(),
    token: Symbol("in-flight-stream"),
    expiresAt: Date.now() + 60_000,
  })
}

function createDeferred<T>(): {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
  readonly reject: (reason: Error) => void
} {
  let resolvePromise: ((value: T) => void) | undefined
  let rejectPromise: ((reason: Error) => void) | undefined
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  return {
    promise,
    resolve: (value) => resolvePromise?.(value),
    reject: (reason) => rejectPromise?.(reason),
  }
}

describe("createAbortSessionRequest reservation release", () => {
  afterEach(() => {
    releaseAllPromptAsyncReservationsForTesting()
  })

  test("#given a session reserved by model-suggestion-retry on a provider retry signal #when the runtime-fallback abort fires #then the reservation is released so the fallback dispatch can acquire the session", async () => {
    // given
    const deps = createDeps()
    const sessionID = "session-model-suggestion-retry-held"
    reserveSession(sessionID, "model-suggestion-retry")
    const abortSessionRequest = createAbortSessionRequest(deps)

    // when
    await abortSessionRequest(sessionID, "session.status.retry-signal")

    // then
    expect(getPromptReservation(sessionID)).toBeUndefined()
  })

  test("#given a session reserved by model-suggestion-retry:sync #when the runtime-fallback abort fires #then the reservation is released", async () => {
    // given
    const deps = createDeps()
    const sessionID = "session-model-suggestion-retry-sync-held"
    reserveSession(sessionID, "model-suggestion-retry:sync")
    const abortSessionRequest = createAbortSessionRequest(deps)

    // when
    await abortSessionRequest(sessionID, "message.updated.retry-signal")

    // then
    expect(getPromptReservation(sessionID)).toBeUndefined()
  })

  test("#given a session reserved by the runtime-fallback path itself #when the abort fires #then the reservation is still released", async () => {
    // given
    const deps = createDeps()
    const sessionID = "session-runtime-fallback-held"
    reserveSession(sessionID, "runtime-fallback:session.status.retry-signal")
    const abortSessionRequest = createAbortSessionRequest(deps)

    // when
    await abortSessionRequest(sessionID, "session.status.retry-signal")

    // then
    expect(getPromptReservation(sessionID)).toBeUndefined()
  })

  test("#given a session reserved by an unrelated user prompt #when the runtime-fallback abort fires #then the reservation is preserved (abort must not steal a foreground user turn)", async () => {
    // given
    const deps = createDeps()
    const sessionID = "session-user-prompt-held"
    reserveSession(sessionID, "user-prompt")
    const abortSessionRequest = createAbortSessionRequest(deps)

    // when
    await abortSessionRequest(sessionID, "session.status.retry-signal")

    // then
    expect(getPromptReservation(sessionID)?.source).toBe("user-prompt")
  })
  test("#given a watchdog aborts a still-running session #when the abort fires #then the abort is marked internal for the resulting session.error", async () => {
    // given
    const deps = createDeps()
    const sessionID = "session-first-prompt-watchdog"
    const abortSessionRequest = createAbortSessionRequest(deps)

    // when
    const aborted = await abortSessionRequest(sessionID, "first-prompt-watchdog")

    // then
    expect(aborted).toBe(true)
    expect(deps.internallyAbortedSessions.has(sessionID)).toBe(true)
  })

  test("#given a watchdog abort request fails #when the abort rejects #then no internal-abort marker remains", async () => {
    const deps = createDeps()
    const sessionID = "session-first-prompt-watchdog-abort-failed"
    deps.ctx.client.session.abort = async () => {
      throw new Error("abort failed")
    }
    const abortSessionRequest = createAbortSessionRequest(deps)

    const aborted = await abortSessionRequest(sessionID, "first-prompt-watchdog")

    expect(aborted).toBe(false)
    expect(deps.internallyAbortedSessions.has(sessionID)).toBe(false)
  })

  test("#given the SDK resolves a non-2xx abort #when the watchdog aborts #then ownership and the prompt reservation are preserved", async () => {
    const deps = createDeps()
    const sessionID = "session-first-prompt-watchdog-abort-resolved-error"
    let abortCalledWithThrowOnError = false
    reserveSession(sessionID, "model-suggestion-retry")
    deps.ctx.client.session.abort = async (input) => {
      abortCalledWithThrowOnError = input.throwOnError === true
      return {
        data: undefined,
        error: { name: "NotFoundError" },
        response: new Response(null, { status: 404 }),
      }
    }
    const abortSessionRequest = createAbortSessionRequest(deps)

    const aborted = await abortSessionRequest(sessionID, "first-prompt-watchdog")

    expect(aborted).toBe(false)
    expect(abortCalledWithThrowOnError).toBe(true)
    expect(deps.internallyAbortedSessions.has(sessionID)).toBe(false)
    expect(getPromptReservation(sessionID)?.source).toBe("model-suggestion-retry")
  })

  test("#given two overlapping internal aborts #when the newer abort fails before the older abort succeeds #then the older abort keeps internal ownership", async () => {
    const deps = createDeps()
    const sessionID = "session-overlapping-internal-aborts"
    const firstAbort = createDeferred<unknown>()
    const secondAbort = createDeferred<unknown>()
    let abortCallCount = 0
    deps.ctx.client.session.abort = () => {
      abortCallCount += 1
      return abortCallCount === 1 ? firstAbort.promise : secondAbort.promise
    }
    const abortSessionRequest = createAbortSessionRequest(deps)

    const olderRequest = abortSessionRequest(sessionID, "session.status.retry-signal")
    const newerRequest = abortSessionRequest(sessionID, "first-prompt-watchdog")
    secondAbort.reject(new Error("newer abort failed"))
    expect(await newerRequest).toBe(false)
    firstAbort.resolve({})
    expect(await olderRequest).toBe(true)

    expect(deps.internallyAbortedSessions.has(sessionID)).toBe(true)
  })

  test("#given an abort starts with one prompt reservation #when a newer reservation replaces it before abort completion #then the newer reservation remains owned", async () => {
    const deps = createDeps()
    const sessionID = "session-abort-reservation-aba"
    const abortResult = createDeferred<unknown>()
    reserveSession(sessionID, "model-suggestion-retry")
    deps.ctx.client.session.abort = () => abortResult.promise
    const abortSessionRequest = createAbortSessionRequest(deps)

    const request = abortSessionRequest(sessionID, "session.status.retry-signal")
    reserveSession(sessionID, "runtime-fallback:new-owner")
    abortResult.resolve({})
    expect(await request).toBe(true)

    expect(getPromptReservation(sessionID)?.source).toBe("runtime-fallback:new-owner")
  })
})
