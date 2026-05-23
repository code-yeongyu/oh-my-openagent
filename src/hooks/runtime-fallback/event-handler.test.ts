/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import type { HookDeps, RuntimeFallbackPluginInput } from "./types"
import type { AutoRetryHelpers } from "./auto-retry"
import { createFallbackState } from "./fallback-state"
import { createEventHandler } from "./event-handler"

const testPluginConfig = {
  git_master: {
    commit_footer: true,
    include_co_authored_by: true,
    git_env_prefix: "GIT_MASTER=1",
  },
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
    },
    options: undefined,
    pluginConfig: testPluginConfig,
    sessionStates: new Map(),
    sessionLastAccess: new Map(),
    sessionRetryInFlight: new Set(),
    sessionAwaitingFallbackResult: new Set(),
    sessionFallbackTimeouts: new Map(),
    sessionStatusRetryKeys: new Map(),
    internallyAbortedSessions: new Set(),
  }
}

function createHelpers(deps: HookDeps, abortCalls: string[], clearCalls: string[], autoRetryCalls: Array<{ sessionID: string; model: string; source: string }> = []): AutoRetryHelpers {
  return {
    abortSessionRequest: async (sessionID: string) => {
      abortCalls.push(sessionID)
    },
    clearSessionFallbackTimeout: (sessionID: string) => {
      clearCalls.push(sessionID)
      deps.sessionFallbackTimeouts.delete(sessionID)
    },
    scheduleSessionFallbackTimeout: () => {},
    autoRetryWithFallback: async (sessionID: string, model: string, _agent: string | undefined, source: string) => {
      autoRetryCalls.push({ sessionID, model, source })
    },
    resolveAgentForSessionFromContext: async () => "sisyphus",
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
    expect(state.pendingFallbackModel).toBeUndefined()
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

  it("#given an object-shaped pending fallback model #when session.error arrives for that model #then the fallback chain advances", async () => {
    // given
    const sessionID = "session-error-object-model"
    const deps = createDeps()
    deps.pluginConfig = {
      ...testPluginConfig,
      agents: {
        sisyphus: {
          fallback_models: ["github-copilot/claude-haiku-4.5", "openai/gpt-5.4"],
        },
      },
    }
    const abortCalls: string[] = []
    const clearCalls: string[] = []
    const autoRetryCalls: Array<{ sessionID: string; model: string; source: string }> = []
    const state = createFallbackState("opencode-go/glm-5.1")
    state.currentModel = "github-copilot/claude-haiku-4.5"
    state.fallbackIndex = 0
    state.pendingFallbackModel = "github-copilot/claude-haiku-4.5"
    state.attemptCount = 1
    deps.sessionStates.set(sessionID, state)
    deps.sessionAwaitingFallbackResult.add(sessionID)
    const handler = createEventHandler(deps, createHelpers(deps, abortCalls, clearCalls, autoRetryCalls))

    // when
    await handler({
      event: {
        type: "session.error",
        properties: {
          sessionID,
          model: { providerID: "github-copilot", modelID: "claude-haiku-4.5" },
          error: { name: "RateLimitError", status: 429, message: "rate limit exceeded" },
        },
      },
    })

    // then
    expect(deps.sessionAwaitingFallbackResult.has(sessionID)).toBe(false)
    expect(autoRetryCalls).toEqual([{ sessionID, model: "openai/gpt-5.4", source: "session.error" }])
  })

  it("#given an object-shaped pending fallback model with a variant #when session.error arrives for that model #then the fallback chain advances", async () => {
    // given
    const sessionID = "session-error-object-model-variant"
    const deps = createDeps()
    deps.pluginConfig = {
      ...testPluginConfig,
      agents: {
        sisyphus: {
          fallback_models: [
            { model: "github-copilot/claude-haiku-4.5", variant: "high" },
            "openai/gpt-5.4",
          ],
        },
      },
    }
    const abortCalls: string[] = []
    const clearCalls: string[] = []
    const autoRetryCalls: Array<{ sessionID: string; model: string; source: string }> = []
    const state = createFallbackState("opencode-go/glm-5.1")
    state.currentModel = "github-copilot/claude-haiku-4.5(high)"
    state.fallbackIndex = 0
    state.pendingFallbackModel = "github-copilot/claude-haiku-4.5(high)"
    state.attemptCount = 1
    deps.sessionStates.set(sessionID, state)
    deps.sessionAwaitingFallbackResult.add(sessionID)
    const handler = createEventHandler(deps, createHelpers(deps, abortCalls, clearCalls, autoRetryCalls))

    // when
    await handler({
      event: {
        type: "session.error",
        properties: {
          sessionID,
          model: { providerID: "github-copilot", modelID: "claude-haiku-4.5", variant: "high" },
          error: { name: "RateLimitError", status: 429, message: "rate limit exceeded" },
        },
      },
    })

    // then
    expect(deps.sessionAwaitingFallbackResult.has(sessionID)).toBe(false)
    expect(autoRetryCalls).toEqual([{ sessionID, model: "openai/gpt-5.4", source: "session.error" }])
  })

  it("#given a model object without variant and a top-level variant #when session.error arrives #then the fallback chain advances", async () => {
    // given
    const sessionID = "session-error-mixed-model-variant"
    const deps = createDeps()
    deps.pluginConfig = {
      ...testPluginConfig,
      agents: {
        sisyphus: {
          fallback_models: [
            { model: "github-copilot/claude-haiku-4.5", variant: "high" },
            "openai/gpt-5.4",
          ],
        },
      },
    }
    const abortCalls: string[] = []
    const clearCalls: string[] = []
    const autoRetryCalls: Array<{ sessionID: string; model: string; source: string }> = []
    const state = createFallbackState("opencode-go/glm-5.1")
    state.currentModel = "github-copilot/claude-haiku-4.5(high)"
    state.fallbackIndex = 0
    state.pendingFallbackModel = "github-copilot/claude-haiku-4.5(high)"
    state.attemptCount = 1
    deps.sessionStates.set(sessionID, state)
    deps.sessionAwaitingFallbackResult.add(sessionID)
    const handler = createEventHandler(deps, createHelpers(deps, abortCalls, clearCalls, autoRetryCalls))

    // when
    await handler({
      event: {
        type: "session.error",
        properties: {
          sessionID,
          model: { providerID: "github-copilot", modelID: "claude-haiku-4.5" },
          variant: "high",
          error: { name: "RateLimitError", status: 429, message: "rate limit exceeded" },
        },
      },
    })

    // then
    expect(deps.sessionAwaitingFallbackResult.has(sessionID)).toBe(false)
    expect(autoRetryCalls).toEqual([{ sessionID, model: "openai/gpt-5.4", source: "session.error" }])
  })

  it("#given a top-level event model with a variant #when session.error bootstraps fallback state #then the fallback chain advances", async () => {
    // given
    const sessionID = "session-error-top-level-model-variant"
    const deps = createDeps()
    deps.pluginConfig = {
      ...testPluginConfig,
      agents: {
        sisyphus: {
          fallback_models: [
            { model: "github-copilot/claude-haiku-4.5", variant: "high" },
            "openai/gpt-5.4",
          ],
        },
      },
    }
    const abortCalls: string[] = []
    const clearCalls: string[] = []
    const autoRetryCalls: Array<{ sessionID: string; model: string; source: string }> = []
    const handler = createEventHandler(deps, createHelpers(deps, abortCalls, clearCalls, autoRetryCalls))

    // when
    await handler({
      event: {
        type: "session.error",
        properties: {
          sessionID,
          providerID: "github-copilot",
          modelID: "claude-haiku-4.5",
          variant: "high",
          error: { name: "RateLimitError", status: 429, message: "rate limit exceeded" },
        },
      },
    })

    // then
    expect(deps.sessionStates.get(sessionID)?.originalModel).toBe("github-copilot/claude-haiku-4.5(high)")
    expect(autoRetryCalls).toEqual([{ sessionID, model: "openai/gpt-5.4", source: "session.error" }])
  })

  it("#given a session.created info model object and separate variant #when the event is handled #then fallback state keeps the variant", async () => {
    // given
    const sessionID = "session-created-info-mixed-variant"
    const deps = createDeps()
    const abortCalls: string[] = []
    const clearCalls: string[] = []
    const handler = createEventHandler(deps, createHelpers(deps, abortCalls, clearCalls))

    // when
    await handler({
      event: {
        type: "session.created",
        properties: {
          info: {
            id: sessionID,
            model: { providerID: "github-copilot", modelID: "claude-haiku-4.5" },
            variant: "high",
          },
        },
      },
    })

    // then
    const state = deps.sessionStates.get(sessionID)
    expect(state?.originalModel).toBe("github-copilot/claude-haiku-4.5(high)")
    expect(state?.currentModel).toBe("github-copilot/claude-haiku-4.5(high)")
  })

  it("#given top-level session.created provider model fields with a variant #when the event is handled #then fallback state keeps the variant", async () => {
    // given
    const sessionID = "session-created-top-level-variant"
    const deps = createDeps()
    const abortCalls: string[] = []
    const clearCalls: string[] = []
    const handler = createEventHandler(deps, createHelpers(deps, abortCalls, clearCalls))

    // when
    await handler({
      event: {
        type: "session.created",
        properties: {
          sessionID,
          providerID: "github-copilot",
          modelID: "claude-haiku-4.5",
          variant: "high",
        },
      },
    })

    // then
    const state = deps.sessionStates.get(sessionID)
    expect(state?.originalModel).toBe("github-copilot/claude-haiku-4.5(high)")
    expect(state?.currentModel).toBe("github-copilot/claude-haiku-4.5(high)")
  })
})
