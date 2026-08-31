import { afterEach, describe, expect, test } from "bun:test"

import { releaseAllPromptAsyncReservationsForTesting } from "../../shared/prompt-async-gate"
import { getPromptReservation, setPromptReservation } from "@oh-my-opencode/utils/prompt-async-gate/reservations"
import { createAbortSessionRequest } from "./auto-retry-abort"
import { createEventHandler } from "./event-handler"
import { createFallbackState } from "./fallback-state"
import type { AutoRetryHelpers } from "./auto-retry"
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

function createHelpers(deps: HookDeps, abortCalls: string[], clearCalls: string[]): AutoRetryHelpers {
  return {
    abortSessionRequest: async (sessionID: string) => {
      abortCalls.push(sessionID)
    },
    clearSessionFallbackTimeout: (sessionID: string) => {
      clearCalls.push(sessionID)
      deps.sessionFallbackTimeouts.delete(sessionID)
    },
    scheduleSessionFallbackTimeout: () => {},
    autoRetryWithFallback: async () => {},
    resolveAgentForSessionFromContext: async () => undefined,
    cleanupStaleSessions: () => {},
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
})

describe("createAbortSessionRequest internal-abort classification", () => {
  afterEach(() => {
    releaseAllPromptAsyncReservationsForTesting()
  })

  test("#given a first-prompt watchdog abort #when abortSessionRequest records the source #then the session is classified as internally aborted so session.error preserves retry state", async () => {
    // given
    const deps = createDeps()
    const sessionID = "session-watchdog-abort"
    const abortSessionRequest = createAbortSessionRequest(deps)

    // when
    await abortSessionRequest(sessionID, "first-prompt-watchdog")

    // then
    expect(deps.internallyAbortedSessions.has(sessionID)).toBe(true)
  })

  test("#given a subagent quota abort with no fallback configured #when abortSessionRequest records the source #then the session is classified as internally aborted", async () => {
    // given
    const deps = createDeps()
    const sessionID = "session-subagent-quota-abort"
    const abortSessionRequest = createAbortSessionRequest(deps)

    // when
    await abortSessionRequest(sessionID, "message.updated.subagent-quota-no-fallback")

    // then
    expect(deps.internallyAbortedSessions.has(sessionID)).toBe(true)
  })

  test("#given a user-initiated session.stop abort #when abortSessionRequest records the source #then the session is NOT classified as internally aborted", async () => {
    // given
    const deps = createDeps()
    const sessionID = "session-user-stop-abort"
    const abortSessionRequest = createAbortSessionRequest(deps)

    // when
    await abortSessionRequest(sessionID, "session.stop")

    // then - an explicit user stop must stay on the cancellation path
    expect(deps.internallyAbortedSessions.has(sessionID)).toBe(false)
  })

  test("#given a user-initiated cancel surfaced as an abort session.error #when the event handler processes it #then the session is marked cancelled but a fresh accepted user message releases the mark on the next idle", async () => {
    // given
    const deps = createDeps()
    const sessionID = "session-cancel-released"
    const abortCalls: string[] = []
    const clearCalls: string[] = []
    const state = createFallbackState("lmstudio/google/gemma-4-26b-a4b")
    state.currentModel = "lmstudio/qwen3-vl-30b"
    state.attemptCount = 1
    deps.sessionStates.set(sessionID, state)
    const handler = createEventHandler(deps, createHelpers(deps, abortCalls, clearCalls))

    // when - external abort poisons, then a fresh user turn arrives, then idle fires
    await handler({ event: { type: "session.error", properties: { sessionID, error: { name: "MessageAbortedError" } } } })
    const poisoned = deps.sessionStates.get(sessionID)
    expect(poisoned?.attemptCount).toBe(0)
    poisoned.attemptCount = 2

    await handler({ event: { type: "message.updated", properties: { info: { role: "user", sessionID } } } })
    await handler({ event: { type: "session.idle", properties: { sessionID } } })

    // then - the cancel mark was released by the accepted user dispatch; idle must not reset accounting
    expect(deps.sessionStates.get(sessionID)?.attemptCount).toBe(2)
  })
})
