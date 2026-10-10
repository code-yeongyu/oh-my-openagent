import { afterEach, describe, expect, it } from "bun:test"
import type { HookDeps, RuntimeFallbackPluginInput } from "./types"
import type { AutoRetryHelpers } from "./auto-retry"
import { createFallbackState } from "./fallback-state"
import { createEventHandler } from "./event-handler"
import { SessionCategoryRegistry } from "../../shared/session-category-registry"

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

afterEach(() => {
  SessionCategoryRegistry.clear()
})

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
    deps.sessionStatusRetryKeys.set(sessionID, new Set(["retry:1"]))
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
    deps.sessionStatusRetryKeys.set(sessionID, new Set(["retry:1"]))
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
    deps.sessionStatusRetryKeys.set(sessionID, new Set(["retry:2"]))
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
    const advanced = deps.sessionStates.get(sessionID)
    expect(advanced).toBeDefined()
    if (!advanced) return
    advanced.attemptCount = 2

    // iteration 2: another internal abort
    deps.internallyAbortedSessions.add(sessionID)
    await handler({ event: { type: "session.error", properties: { sessionID, error: { name: "MessageAbortedError" } } } })

    // then - counter is at 2, not reset to 0
    expect(deps.sessionStates.get(sessionID)?.attemptCount).toBe(2)
  })

  it("#given a mid-cycle fallback state and our own abort in flight #when session.stop echoes back #then the fallback position is preserved (issue #6751)", async () => {
    // given - a fallback hop was just prepared (primary failed, dispatch to
    // fallback model in flight) and our machinery aborted the session, so
    // internallyAbortedSessions carries the flag. opencode echoes session.stop
    // back at us; that echo must not wipe fallbackIndex/failedModels.
    const sessionID = "session-6751-stop-echo"
    const deps = createDeps()
    const abortCalls: string[] = []
    const clearCalls: string[] = []
    const state = createFallbackState("zai/primary")
    state.currentModel = "go/fallback-a"
    state.fallbackIndex = 1
    state.attemptCount = 1
    state.pendingFallbackModel = "go/fallback-a"
    state.failedModels.set("zai/primary", Date.now())
    deps.sessionStates.set(sessionID, state)
    deps.internallyAbortedSessions.add(sessionID)
    const handler = createEventHandler(deps, createHelpers(deps, abortCalls, clearCalls))

    // when
    await handler({ event: { type: "session.stop", properties: { sessionID } } })

    // then - position bookkeeping intact so the cycle can advance forward
    const preserved = deps.sessionStates.get(sessionID)
    expect(preserved).toBe(state)
    expect(preserved?.fallbackIndex).toBe(1)
    expect(preserved?.currentModel).toBe("go/fallback-a")
    expect(preserved?.originalModel).toBe("zai/primary")
    expect(preserved?.attemptCount).toBe(1)
    expect(preserved?.pendingFallbackModel).toBe("go/fallback-a")
    expect(preserved?.failedModels.get("zai/primary")).toBeDefined()
  })

  it("#given a mid-cycle fallback state and our own abort in flight #when session.stop and session.idle echo back #then the fallback position survives both echoes (issue #6751)", async () => {
    // given - a fallback hop was just prepared and our machinery aborted the
    // session. opencode echoes stop then idle ("Cleared fallback retry state
    // for cancelled session on idle" in the issue log); neither echo may wipe
    // fallbackIndex/failedModels/pendingFallbackModel mid-cycle.
    const sessionID = "session-6751-idle-echo"
    const deps = createDeps()
    const abortCalls: string[] = []
    const clearCalls: string[] = []
    const state = createFallbackState("zai/primary")
    state.currentModel = "go/fallback-a"
    state.fallbackIndex = 1
    state.attemptCount = 1
    state.pendingFallbackModel = "go/fallback-a"
    state.failedModels.set("zai/primary", Date.now())
    deps.sessionStates.set(sessionID, state)
    deps.sessionAwaitingFallbackResult.add(sessionID)
    deps.internallyAbortedSessions.add(sessionID)
    const handler = createEventHandler(deps, createHelpers(deps, abortCalls, clearCalls))

    // when
    await handler({ event: { type: "session.stop", properties: { sessionID } } })
    await handler({ event: { type: "session.idle", properties: { sessionID } } })

    // then
    const preserved = deps.sessionStates.get(sessionID)
    expect(preserved).toBe(state)
    expect(preserved?.fallbackIndex).toBe(1)
    expect(preserved?.currentModel).toBe("go/fallback-a")
    expect(preserved?.pendingFallbackModel).toBe("go/fallback-a")
    expect(preserved?.failedModels.get("zai/primary")).toBeDefined()
    expect(deps.sessionAwaitingFallbackResult.has(sessionID)).toBe(true)
  })

  it("#given an internal-abort echo wiped into a reset #when the next failure arrives #then the chain still advances forward past already-failed models (issue #6751)", async () => {
    // given - issue shape: primary is chain[0], primary and first fallback both
    // fail. The abort echoes between hops must not rewind the position.
    const sessionID = "ses_6751_forward-only"
    const deps = createDeps()
    deps.pluginConfig = {
      agents: {
        sisyphus: {
          model: "zai/primary",
          fallback_models: ["zai/primary", "go/fallback-a", "zen/fallback-b"],
        },
      },
    }
    const abortCalls: string[] = []
    const clearCalls: string[] = []
    const dispatchedModels: string[] = []
    const helpers: AutoRetryHelpers = {
      ...createHelpers(deps, abortCalls, clearCalls),
      autoRetryWithFallback: async (_sessionID, newModel) => {
        dispatchedModels.push(newModel)
        return { accepted: true, status: "dispatched" }
      },
      resolveAgentForSessionFromContext: async () => "sisyphus",
    }
    const handler = createEventHandler(deps, helpers)

    // when - primary fails -> hop to index 1; our abort echoes stop+idle;
    // then the first fallback fails too.
    await handler({
      event: {
        type: "session.created",
        properties: { info: { id: sessionID, agent: "sisyphus", model: "zai/primary" } },
      },
    })
    await handler({
      event: {
        type: "session.error",
        properties: { sessionID, error: { name: "ProviderError", message: "service unavailable", statusCode: 503 } },
      },
    })
    deps.internallyAbortedSessions.add(sessionID)
    await handler({ event: { type: "session.stop", properties: { sessionID } } })
    await handler({ event: { type: "session.idle", properties: { sessionID } } })
    await handler({
      event: {
        type: "session.error",
        properties: { sessionID, error: { name: "MessageAbortedError", message: "aborted" } },
      },
    })
    await handler({
      event: {
        type: "session.error",
        properties: { sessionID, error: { name: "ProviderError", message: "monthly usage limit reached", statusCode: 503 } },
      },
    })

    // then - second hop must be zen/fallback-b (index 2), never a repeat of
    // zai/primary or go/fallback-a
    expect(dispatchedModels).toEqual(["go/fallback-a", "zen/fallback-b"])
    const finalState = deps.sessionStates.get(sessionID)
    expect(finalState?.fallbackIndex).toBe(2)
    expect(finalState?.currentModel).toBe("zen/fallback-b")
    expect(finalState?.originalModel).toBe("zai/primary")
    expect(finalState?.failedModels.has("zai/primary")).toBe(true)
    expect(finalState?.failedModels.has("go/fallback-a")).toBe(true)
  })

  it("#given a genuine user stop with no internal abort in flight #when session.stop fires #then the fallback position is fully reset as a new-cycle boundary", async () => {
    // given - regression guard for #6751 fix: explicit user action keeps its
    // existing full-reset semantics. No internallyAbortedSessions entry here.
    const sessionID = "session-6751-genuine-stop"
    const deps = createDeps()
    const abortCalls: string[] = []
    const clearCalls: string[] = []
    const state = createFallbackState("zai/primary")
    state.currentModel = "go/fallback-a"
    state.fallbackIndex = 1
    state.attemptCount = 2
    state.pendingFallbackModel = "go/fallback-a"
    state.failedModels.set("zai/primary", Date.now())
    deps.sessionStates.set(sessionID, state)
    const handler = createEventHandler(deps, createHelpers(deps, abortCalls, clearCalls))

    // when
    await handler({ event: { type: "session.stop", properties: { sessionID } } })

    // then
    const reset = deps.sessionStates.get(sessionID)
    expect(reset).not.toBe(state)
    expect(reset?.originalModel).toBe("zai/primary")
    expect(reset?.currentModel).toBe("zai/primary")
    expect(reset?.fallbackIndex).toBe(-1)
    expect(reset?.attemptCount).toBe(0)
    expect(reset?.failedModels.size).toBe(0)
    expect(reset?.pendingFallbackModel).toBe(undefined)
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
    expect(created?.originalModel).toBe("openai/gpt-5.5-codex(medium)")
    expect(created?.currentModel).toBe("openai/gpt-5.5-codex(medium)")
    expect(typeof created?.currentModel).toBe("string")
  })

  it("#given session.created on an inherited-variant fallback #when the configured fallback is base-only #then the fallback index is retained", async () => {
    // given
    const sessionID = "session-inherited-variant-fallback-created"
    const deps = createDeps()
    deps.pluginConfig = {
      agents: {
        sisyphus: {
          model: "anthropic/claude-opus-4-7",
          variant: "high",
          fallback_models: ["openai/gpt-5.4", "google/gemini-2.5-pro"],
        },
      },
    }
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
            agent: "sisyphus",
            model: {
              id: "gpt-5.4",
              providerID: "openai",
              variant: "high",
            },
          },
        },
      },
    })

    // then
    const created = deps.sessionStates.get(sessionID)
    expect(created?.originalModel).toBe("anthropic/claude-opus-4-7")
    expect(created?.currentModel).toBe("openai/gpt-5.4(high)")
    expect(created?.fallbackIndex).toBe(0)
  })

  it("#given session.created on a category-variant fallback #when the configured fallback is base-only #then the fallback index is retained", async () => {
    // given
    const sessionID = "session-category-variant-fallback-created"
    const deps = createDeps()
    deps.pluginConfig = {
      agents: {
        sisyphus: {
          model: "anthropic/claude-opus-4-7",
          category: "deep",
          fallback_models: ["openai/gpt-5.4", "google/gemini-2.5-pro"],
        },
      },
      categories: {
        deep: {
          variant: "high",
        },
      },
    }
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
            agent: "sisyphus",
            model: {
              id: "gpt-5.4",
              providerID: "openai",
              variant: "high",
            },
          },
        },
      },
    })

    // then
    const created = deps.sessionStates.get(sessionID)
    expect(created?.originalModel).toBe("anthropic/claude-opus-4-7")
    expect(created?.currentModel).toBe("openai/gpt-5.4(high)")
    expect(created?.fallbackIndex).toBe(0)
  })

  it("#given session.created on a registered-category fallback #when that category supplies the effective reasoning #then the active fallback is indexed with the category identity", async () => {
    // given
    const sessionID = "session-registered-category-fallback-created"
    const deps = createDeps()
    deps.pluginConfig = {
      agents: {
        sisyphus: {
          reasoning: "low",
        },
      },
      categories: {
        deep: {
          model: "anthropic/claude-opus-4-7",
          reasoning: "high",
          fallback_models: ["openai/gpt-5.4", "google/gemini-2.5-pro"],
        },
      },
    }
    SessionCategoryRegistry.register(sessionID, "deep")
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
            agent: "sisyphus",
            model: {
              id: "gpt-5.4",
              providerID: "openai",
              variant: "high",
            },
          },
        },
      },
    })

    // then
    const created = deps.sessionStates.get(sessionID)
    expect(created?.originalModel).toBe("anthropic/claude-opus-4-7")
    expect(created?.currentModel).toBe("openai/gpt-5.4(high)")
    expect(created?.fallbackIndex).toBe(0)
  })

  it("#given session.created on a fallback whose inherited reasoning lowers to effort #when the event reports the base model #then the fallback index is retained", async () => {
    // given
    const sessionID = "session-category-reasoning-fallback-created"
    const deps = createDeps()
    deps.pluginConfig = {
      agents: {
        sisyphus: {
          model: "anthropic/claude-opus-4-7",
          category: "deep",
          fallback_models: ["test-provider/test-model", "google/gemini-2.5-pro"],
        },
      },
      categories: {
        deep: {
          reasoning: "high",
        },
      },
    }
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
            agent: "sisyphus",
            model: {
              id: "test-model",
              providerID: "test-provider",
            },
          },
        },
      },
    })

    // then
    const created = deps.sessionStates.get(sessionID)
    expect(created?.originalModel).toBe("anthropic/claude-opus-4-7")
    expect(created?.currentModel).toBe("test-provider/test-model")
    expect(created?.fallbackIndex).toBe(0)
  })
})
