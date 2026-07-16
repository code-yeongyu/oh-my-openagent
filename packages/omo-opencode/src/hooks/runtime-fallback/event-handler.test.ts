import { describe, expect, it } from "bun:test"
import type { HookDeps, RuntimeFallbackPluginInput } from "./types"
import type { AutoRetryHelpers } from "./auto-retry"
import { createFallbackState } from "./fallback-state"
import { createEventHandler } from "./event-handler"

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
    pluginConfig: {},
    sessionStates: new Map(),
    sessionLastAccess: new Map(),
    sessionRetryInFlight: new Set(),
    sessionAwaitingFallbackResult: new Set(),
    sessionFallbackTimeouts: new Map(),
    sessionStatusRetryKeys: new Map(),
    internallyAbortedSessions: new Set(),
  }
}

function createHelpers(deps: HookDeps, abortCalls: string[], clearCalls: string[]): AutoRetryHelpers {
  return {
    abortSessionRequest: async (sessionID: string) => {
      abortCalls.push(sessionID)
      return true
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

describe("createEventHandler", () => {
  it("#given a session retry dedupe key #when session.stop fires #then the retry dedupe key is cleared", async () => {
    // given
    const sessionID = "session-stop"
    const deps = createDeps()
    const abortCalls: string[] = []
    const clearCalls: string[] = []
    const state = createFallbackState("google/gemini-2.5-pro")
    state.pendingFallbackModel = "openai/gpt-5.4"
    deps.sessionStates.set(sessionID, state)
    deps.sessionRetryInFlight.add(sessionID)
    deps.sessionStatusRetryKeys.set(sessionID, "retry:1")
    const handler = createEventHandler(deps, createHelpers(deps, abortCalls, clearCalls))

    // when
    await handler({ event: { type: "session.stop", properties: { sessionID } } })

    // then
    expect(deps.sessionStatusRetryKeys.has(sessionID)).toBe(false)
    expect(clearCalls).toEqual([sessionID])
    expect(abortCalls).toEqual([sessionID])
  })

  it("#given a session retry dedupe key without a pending fallback result #when session.idle fires #then the retry dedupe key is cleared", async () => {
    // given
    const sessionID = "session-idle"
    const deps = createDeps()
    const abortCalls: string[] = []
    const clearCalls: string[] = []
    const state = createFallbackState("google/gemini-2.5-pro")
    state.pendingFallbackModel = "openai/gpt-5.4"
    deps.sessionStates.set(sessionID, state)
    deps.sessionRetryInFlight.add(sessionID)
    deps.sessionFallbackTimeouts.set(sessionID, 1)
    deps.sessionStatusRetryKeys.set(sessionID, "retry:1")
    const handler = createEventHandler(deps, createHelpers(deps, abortCalls, clearCalls))

    // when
    await handler({ event: { type: "session.idle", properties: { sessionID } } })

    // then
    expect(deps.sessionStatusRetryKeys.has(sessionID)).toBe(false)
    expect(clearCalls).toEqual([sessionID])
    expect(abortCalls).toEqual([])
    expect(state.pendingFallbackModel).toBe(undefined)
  })

  it("#given a cancelled session #when session.error receives an abort error #then fallback retry state is reset", async () => {
    const sessionID = "session-cancelled"
    const deps = createDeps()
    const abortCalls: string[] = []
    const clearCalls: string[] = []
    const state = createFallbackState("google/gemini-2.5-pro")
    state.currentModel = "openai/gpt-5.4"
    state.fallbackIndex = 1
    state.attemptCount = 2
    state.pendingFallbackModel = "openai/gpt-5.4"
    state.failedModels.set("google/gemini-2.5-pro", Date.now())
    deps.sessionStates.set(sessionID, state)
    deps.sessionRetryInFlight.add(sessionID)
    deps.sessionAwaitingFallbackResult.add(sessionID)
    deps.sessionStatusRetryKeys.set(sessionID, "retry:2")
    const handler = createEventHandler(deps, createHelpers(deps, abortCalls, clearCalls))

    await handler({ event: { type: "session.error", properties: { sessionID, error: { name: "AbortError" } } } })

    const resetState = deps.sessionStates.get(sessionID)
    expect(resetState?.originalModel).toBe("google/gemini-2.5-pro")
    expect(resetState?.currentModel).toBe("google/gemini-2.5-pro")
    expect(resetState?.fallbackIndex).toBe(-1)
    expect(resetState?.attemptCount).toBe(0)
    expect(resetState?.pendingFallbackModel).toBe(undefined)
    expect(resetState?.failedModels.size).toBe(0)
    expect(deps.sessionRetryInFlight.has(sessionID)).toBe(false)
    expect(deps.sessionAwaitingFallbackResult.has(sessionID)).toBe(false)
    expect(deps.sessionStatusRetryKeys.has(sessionID)).toBe(false)
    expect(clearCalls).toEqual([sessionID])
    expect(abortCalls).toEqual([])
  })

  it("#given a cancelled session #when session.idle fires #then fallback retry state stays cleared", async () => {
    const sessionID = "session-cancelled-idle"
    const deps = createDeps()
    const abortCalls: string[] = []
    const clearCalls: string[] = []
    const state = createFallbackState("google/gemini-2.5-pro")
    state.currentModel = "openai/gpt-5.4"
    state.fallbackIndex = 1
    state.attemptCount = 2
    state.pendingFallbackModel = "openai/gpt-5.4"
    deps.sessionStates.set(sessionID, state)
    const handler = createEventHandler(deps, createHelpers(deps, abortCalls, clearCalls))

    await handler({ event: { type: "session.error", properties: { sessionID, error: { name: "MessageAbortedError" } } } })
    clearCalls.length = 0

    await handler({ event: { type: "session.idle", properties: { sessionID } } })

    const resetState = deps.sessionStates.get(sessionID)
    expect(resetState?.currentModel).toBe("google/gemini-2.5-pro")
    expect(resetState?.attemptCount).toBe(0)
    expect(clearCalls).toEqual([sessionID])
    expect(abortCalls).toEqual([])
  })

  it("#given a session we aborted ourselves (internal abort flag set) #when session.error fires with isAbort #then fallback retry state is preserved (issue #4006)", async () => {
    // given - we just called abortSessionRequest("session.status.retry-signal");
    // opencode will emit session.error{isAbort:true} as a consequence. The
    // handler must recognize this as our own abort and NOT wipe attemptCount,
    // otherwise the next session.status retry signal restarts the loop at 1.
    const sessionID = "session-internal-abort"
    const deps = createDeps()
    const abortCalls: string[] = []
    const clearCalls: string[] = []
    const state = createFallbackState("opencode-go/glm-5.1")
    state.currentModel = "github-copilot/claude-haiku-4.5"
    state.fallbackIndex = 0
    state.attemptCount = 1
    state.pendingFallbackModel = "github-copilot/claude-haiku-4.5"
    deps.sessionStates.set(sessionID, state)
    deps.internallyAbortedSessions.add(sessionID)
    const handler = createEventHandler(deps, createHelpers(deps, abortCalls, clearCalls))

    // when
    await handler({ event: { type: "session.error", properties: { sessionID, error: { name: "MessageAbortedError" } } } })

    // then - state intact, attemptCount preserved
    const preserved = deps.sessionStates.get(sessionID)
    expect(preserved?.attemptCount).toBe(1)
    expect(preserved?.currentModel).toBe("github-copilot/claude-haiku-4.5")
    expect(preserved?.fallbackIndex).toBe(0)
    // flag was consumed so a subsequent user abort still gets the reset path
    expect(deps.internallyAbortedSessions.has(sessionID)).toBe(false)
  })

  it("#given an external abort (no internal flag) #when session.error fires with isAbort #then state is still reset as a real cancellation", async () => {
    // given - regression guard: user-initiated abort path must continue to
    // wipe state. Only OUR internal aborts get the preservation treatment.
    const sessionID = "session-external-abort"
    const deps = createDeps()
    const abortCalls: string[] = []
    const clearCalls: string[] = []
    const state = createFallbackState("opencode-go/glm-5.1")
    state.currentModel = "github-copilot/claude-haiku-4.5"
    state.attemptCount = 1
    deps.sessionStates.set(sessionID, state)
    // NB: internallyAbortedSessions is empty
    const handler = createEventHandler(deps, createHelpers(deps, abortCalls, clearCalls))

    // when
    await handler({ event: { type: "session.error", properties: { sessionID, error: { name: "MessageAbortedError" } } } })

    // then - state reset, behaviour matches pre-fix cancellation path
    const reset = deps.sessionStates.get(sessionID)
    expect(reset?.attemptCount).toBe(0)
    expect(reset?.currentModel).toBe("opencode-go/glm-5.1")
  })

  it("#given two consecutive internal-abort cycles #when session.error fires each time #then attemptCount can progress past 1", async () => {
    // given - the failure mode in issue #4006 manifested as attempt:1 looping
    // forever because every cycle reset attemptCount. This test verifies the
    // counter actually advances when the internal-abort flag is honored
    // across multiple iterations.
    const sessionID = "session-progressing-attempts"
    const deps = createDeps()
    const abortCalls: string[] = []
    const clearCalls: string[] = []
    const state = createFallbackState("opencode-go/glm-5.1")
    state.attemptCount = 1
    state.pendingFallbackModel = "github-copilot/claude-haiku-4.5"
    deps.sessionStates.set(sessionID, state)
    const handler = createEventHandler(deps, createHelpers(deps, abortCalls, clearCalls))

    // iteration 1: internal abort -> session.error{isAbort:true}
    deps.internallyAbortedSessions.add(sessionID)
    await handler({ event: { type: "session.error", properties: { sessionID, error: { name: "MessageAbortedError" } } } })
    expect(deps.sessionStates.get(sessionID)?.attemptCount).toBe(1)

    // simulate the next retry signal advancing the counter
    const advanced = deps.sessionStates.get(sessionID)!
    advanced.attemptCount = 2

    // iteration 2: another internal abort
    deps.internallyAbortedSessions.add(sessionID)
    await handler({ event: { type: "session.error", properties: { sessionID, error: { name: "MessageAbortedError" } } } })

    // then - counter is at 2, not reset to 0
    expect(deps.sessionStates.get(sessionID)?.attemptCount).toBe(2)
  })

  it("#given session.created with an object-shaped model (opencode 1.15.x) #when the event fires #then state stores a canonical string model (issue #4315)", async () => {
    // given - since opencode 1.15.x, session.created info.model is an object
    // { id, providerID, variant } rather than a string. Storing it verbatim
    // made isEquivalentModel call .toLowerCase() on a non-string and crash.
    const sessionID = "session-object-model"
    const deps = createDeps()
    const abortCalls: string[] = []
    const clearCalls: string[] = []
    const handler = createEventHandler(deps, createHelpers(deps, abortCalls, clearCalls))

    // when
    await handler({
      event: {
        type: "session.created",
        properties: { info: { id: sessionID, model: { id: "gpt-5.5-codex", providerID: "openai", variant: "medium" } } },
      },
    })

    // then - the stored model is the canonical string form, not the object
    const created = deps.sessionStates.get(sessionID)
    expect(created?.originalModel).toBe("openai/gpt-5.5-codex")
    expect(created?.currentModel).toBe("openai/gpt-5.5-codex")
    expect(typeof created?.currentModel).toBe("string")
  })
})
