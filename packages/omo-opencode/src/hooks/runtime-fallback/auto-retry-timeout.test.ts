import { afterEach, describe, expect, test } from "bun:test"

import { createFallbackTimeoutHelpers } from "./auto-retry-timeout"
import { createFallbackState } from "./fallback-state"
import type { HookDeps, RuntimeFallbackPluginInput } from "./types"
import { SessionCategoryRegistry } from "../../shared/session-category-registry"
import { installRuntimeFallbackTestClock, restoreRuntimeFallbackTestClock } from "./test-timeout-clock.test-support"
import { clearAllCompactions, isCompactionInFlight, recordCompactionEnd, recordCompactionStart } from "../../shared/compaction-in-flight"

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
      notify_on_fallback: true,
      restore_primary_after_cooldown: false,
    },
    options: {
      session_timeout_ms: 1,
    },
    pluginConfig: {
      categories: {
        test: {
          fallback_models: ["litellm/openai.eu.gpt-5.5", "google/gemini-2.5-pro"],
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

describe("createFallbackTimeoutHelpers", () => {
  afterEach(() => {
    SessionCategoryRegistry.clear()
    clearAllCompactions()
    restoreRuntimeFallbackTestClock()
  })

  test("#given timeout fallback dispatch is blocked #when the timeout fires #then fallback state is restored", async () => {
    // given
    const sessionID = "session-timeout-dispatch-blocked"
    SessionCategoryRegistry.register(sessionID, "test")
    const deps = createDeps()
    const state = createFallbackState("openai/gpt-5.4")
    deps.sessionStates.set(sessionID, state)

    let retryModel: string | undefined
    let resolveRetry: (() => void) | undefined
    const retryCalled = new Promise<void>((resolve) => {
      resolveRetry = resolve
    })
    const helpers = createFallbackTimeoutHelpers(
      deps,
      async () => {},
      async (_sessionID, model) => {
        retryModel = model
        resolveRetry?.()
        return { accepted: false, status: "blocked", reason: "test gate blocked dispatch" }
      },
    )

    // when
    helpers.scheduleSessionFallbackTimeout(sessionID)
    await Promise.race([
      retryCalled,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("timer did not fire")), 1000)
      }),
    ])
    await new Promise((resolve) => setTimeout(resolve, 0))

    // then
    expect(retryModel).toBe("litellm/openai.eu.gpt-5.5")
    expect(state.currentModel).toBe("openai/gpt-5.4")
    expect(state.fallbackIndex).toBe(-1)
    expect(state.attemptCount).toBe(0)
    expect(state.pendingFallbackModel).toBe(undefined)
    expect(state.failedModels.size).toBe(0)
  })

  test("#given an accepted fallback is awaiting its result #when timeout escalation is blocked #then residue is cleared after the abort", async () => {
    // given
    const sessionID = "session-timeout-awaiting-dispatch-blocked"
    SessionCategoryRegistry.register(sessionID, "test")
    const deps = createDeps()
    deps.options = {
      session_timeout_ms: 1,
    }
    const state = createFallbackState("openai/gpt-5.4")
    state.currentModel = "litellm/openai.eu.gpt-5.5"
    state.fallbackIndex = 0
    deps.sessionStates.set(sessionID, state)
    deps.sessionAwaitingFallbackResult.add(sessionID)

    let resolveRetry: (() => void) | undefined
    const retryCalled = new Promise<void>((resolve) => {
      resolveRetry = resolve
    })
    const helpers = createFallbackTimeoutHelpers(
      deps,
      async () => {},
      async () => {
        resolveRetry?.()
        return { accepted: false, status: "blocked", reason: "test gate blocked dispatch" }
      },
    )

    // when
    helpers.scheduleSessionFallbackTimeout(sessionID)
    await Promise.race([
      retryCalled,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("timer did not fire")), 1000)
      }),
    ])
    await new Promise((resolve) => setTimeout(resolve, 0))

    // then
    expect(deps.sessionAwaitingFallbackResult.has(sessionID)).toBe(false)
    expect(deps.sessionFallbackTimeouts.has(sessionID)).toBe(false)
  })

  test("#given a timeout belongs to an older state generation #when that generation is replaced before its callback runs #then it never aborts the replacement request", async () => {
    // given
    const sessionID = "session-timeout-replaced-before-callback"
    SessionCategoryRegistry.register(sessionID, "test")
    const deps = createDeps()
    deps.options = {
      session_timeout_ms: 1,
    }
    deps.sessionStates.set(sessionID, createFallbackState("openai/gpt-5.4"))
    let abortCalls = 0
    let retryCalls = 0
    const helpers = createFallbackTimeoutHelpers(
      deps,
      async () => {
        abortCalls += 1
      },
      async () => {
        retryCalls += 1
        return { accepted: true, status: "dispatched" }
      },
    )
    const clock = installRuntimeFallbackTestClock()
    helpers.scheduleSessionFallbackTimeout(sessionID)

    // when
    const replacementState = createFallbackState("google/gemini-2.5-pro")
    deps.sessionStates.set(sessionID, replacementState)
    await clock.advanceBy(1)

    // then
    expect(abortCalls).toBe(0)
    expect(retryCalls).toBe(0)
    expect(replacementState.currentModel).toBe("google/gemini-2.5-pro")
  })

  test("#given timeout callback awaits abort #when manual model change replaces state #then the stale generation never dispatches", async () => {
    // given
    const sessionID = "session-timeout-stale-generation"
    SessionCategoryRegistry.register(sessionID, "test")
    const deps = createDeps()
    deps.options = {
      session_timeout_ms: 1,
    }
    deps.sessionStates.set(sessionID, createFallbackState("openai/gpt-5.4"))
    let resolveAbort: (() => void) | undefined
    let markAbortStarted: (() => void) | undefined
    const abortStarted = new Promise<void>((resolve) => {
      markAbortStarted = resolve
    })
    let retryCalls = 0
    const helpers = createFallbackTimeoutHelpers(
      deps,
      async () => new Promise<void>((resolve) => {
        resolveAbort = resolve
        markAbortStarted?.()
      }),
      async () => {
        retryCalls += 1
        return { accepted: true, status: "dispatched" }
      },
    )
    const clock = installRuntimeFallbackTestClock()
    helpers.scheduleSessionFallbackTimeout(sessionID)

    // when
    const advancePromise = clock.advanceBy(1)
    await abortStarted
    const replacementState = createFallbackState("google/gemini-2.5-pro")
    deps.sessionStates.set(sessionID, replacementState)
    if (!resolveAbort) throw new Error("abort did not start")
    resolveAbort()
    await advancePromise

    // then
    expect(retryCalls).toBe(0)
    expect(replacementState.currentModel).toBe("google/gemini-2.5-pro")
  })

  test("#given compaction remains active through the exact budget #when the watchdog reaches 600 seconds #then it aborts once without advancing fallback", async () => {
    const sessionID = "session-timeout-compaction-budget"
    SessionCategoryRegistry.register(sessionID, "test")
    const deps = createDeps()
    deps.options = { session_timeout_ms: 30_000 }
    const state = createFallbackState("openai/gpt-5.4")
    deps.sessionStates.set(sessionID, state)
    deps.sessionAwaitingFallbackResult.add(sessionID)
    deps.sessionAwaitingFallbackResult.add(sessionID)
    deps.sessionRetryInFlight.add(sessionID)
    let abortCalls = 0
    let retryCalls = 0
    let toastCalls = 0
    deps.ctx.client.tui.showToast = async () => {
      toastCalls += 1
      return {}
    }
    const helpers = createFallbackTimeoutHelpers(
      deps,
      async () => { abortCalls += 1 },
      async () => {
        retryCalls += 1
        return { accepted: true, status: "dispatched" }
      },
    )
    const clock = installRuntimeFallbackTestClock(0)
    recordCompactionStart(sessionID)
    helpers.scheduleSessionFallbackTimeout(sessionID)

    await clock.advanceBy(599_999)
    expect(abortCalls).toBe(0)
    expect(retryCalls).toBe(0)
    expect(state.attemptCount).toBe(0)
    expect(state.failedModels.size).toBe(0)
    await clock.advanceBy(1)

    expect(abortCalls).toBe(1)
    expect(retryCalls).toBe(0)
    expect(toastCalls).toBe(1)
    expect(state.attemptCount).toBe(0)
    expect(state.failedModels.size).toBe(0)
    expect(deps.sessionAwaitingFallbackResult.has(sessionID)).toBe(false)
    expect(deps.sessionRetryInFlight.has(sessionID)).toBe(false)
    expect(isCompactionInFlight(sessionID)).toBe(false)
  })

  test("#given the watchdog is re-armed while the budget abort is pending #when the branch returns control #then no watchdog stays armed", async () => {
    const sessionID = "session-timeout-compaction-budget-rearmed"
    SessionCategoryRegistry.register(sessionID, "test")
    const deps = createDeps()
    deps.options = { session_timeout_ms: 30_000 }
    const state = createFallbackState("openai/gpt-5.4")
    deps.sessionStates.set(sessionID, state)
    deps.sessionAwaitingFallbackResult.add(sessionID)
    let abortCalls = 0
    let retryCalls = 0
    const helpers = createFallbackTimeoutHelpers(
      deps,
      async () => {
        abortCalls += 1
        if (abortCalls === 1) helpers.scheduleSessionFallbackTimeout(sessionID)
      },
      async () => {
        retryCalls += 1
        return { accepted: true, status: "dispatched" }
      },
    )
    const clock = installRuntimeFallbackTestClock(0)
    recordCompactionStart(sessionID)
    helpers.scheduleSessionFallbackTimeout(sessionID)

    await clock.advanceBy(600_000)

    expect(abortCalls).toBe(1)
    expect(deps.sessionFallbackTimeouts.has(sessionID)).toBe(false)

    await clock.advanceBy(30_000)

    expect(abortCalls).toBe(1)
    expect(retryCalls).toBe(0)
    expect(state.attemptCount).toBe(0)
  })

  test("#given compaction ends at 100 seconds #when the fresh watchdog window elapses #then it fires at 130 seconds", async () => {
    const sessionID = "session-timeout-compaction-ended-window"
    SessionCategoryRegistry.register(sessionID, "test")
    const deps = createDeps()
    deps.options = { session_timeout_ms: 30_000 }
    const state = createFallbackState("openai/gpt-5.4")
    deps.sessionStates.set(sessionID, state)
    let abortCalls = 0
    const helpers = createFallbackTimeoutHelpers(
      deps,
      async () => { abortCalls += 1 },
      async () => ({ accepted: true, status: "dispatched" }),
    )
    const clock = installRuntimeFallbackTestClock(0)
    recordCompactionStart(sessionID)
    helpers.scheduleSessionFallbackTimeout(sessionID)

    await clock.advanceBy(100_000)
    expect(abortCalls).toBe(0)
    recordCompactionEnd(sessionID)
    helpers.scheduleSessionFallbackTimeout(sessionID)
    await clock.advanceBy(29_999)
    expect(abortCalls).toBe(0)
    await clock.advanceBy(1)
    expect(abortCalls).toBe(1)
  })

  test("#given no fallback can be prepared outside compaction #when the watchdog expires #then it aborts with an explicit wedge-return decision", async () => {
    const sessionID = "session-timeout-no-fallback"
    SessionCategoryRegistry.register(sessionID, "test")
    const deps = createDeps()
    deps.options = { session_timeout_ms: 1 }
    deps.config.max_fallback_attempts = 0
    const state = createFallbackState("openai/gpt-5.4")
    deps.sessionStates.set(sessionID, state)
    deps.sessionAwaitingFallbackResult.add(sessionID)
    let abortCalls = 0
    let retryCalls = 0
    let toastCalls = 0
    deps.ctx.client.tui.showToast = async () => {
      toastCalls += 1
      return {}
    }
    const helpers = createFallbackTimeoutHelpers(
      deps,
      async () => { abortCalls += 1 },
      async () => {
        retryCalls += 1
        return { accepted: true, status: "dispatched" }
      },
    )
    const clock = installRuntimeFallbackTestClock(0)
    helpers.scheduleSessionFallbackTimeout(sessionID)
    await clock.advanceBy(1)

    expect(abortCalls).toBe(1)
    expect(retryCalls).toBe(0)
    expect(toastCalls).toBe(1)
    expect(state.attemptCount).toBe(0)
    expect(deps.sessionAwaitingFallbackResult.has(sessionID)).toBe(false)
  })

  test("#given a resolved agent on the original timer #when progress re-arms without an agent #then fallback dispatch keeps that agent", async () => {
    const sessionID = "session-timeout-agent-rearm"
    const deps = createDeps()
    deps.options = { session_timeout_ms: 1 }
    deps.pluginConfig = {
      agents: {
        worker: { fallback_models: ["litellm/openai.eu.gpt-5.5"] },
      },
    }
    const state = createFallbackState("openai/gpt-5.4")
    deps.sessionStates.set(sessionID, state)
    let dispatchedAgent: string | undefined
    const helpers = createFallbackTimeoutHelpers(
      deps,
      async () => {},
      async (_sessionID, _model, resolvedAgent) => {
        dispatchedAgent = resolvedAgent
        return { accepted: true, status: "dispatched" }
      },
    )
    const clock = installRuntimeFallbackTestClock(0)
    helpers.scheduleSessionFallbackTimeout(sessionID, "worker")
    helpers.scheduleSessionFallbackTimeout(sessionID)
    await clock.advanceBy(1)

    expect(dispatchedAgent).toBe("worker")
  })

  test("#given fallback dispatch is refused after the timeout abort #when the watchdog fires #then the user receives one toast", async () => {
    const sessionID = "session-timeout-dispatch-refused-toast"
    SessionCategoryRegistry.register(sessionID, "test")
    const deps = createDeps()
    deps.options = { session_timeout_ms: 1 }
    const state = createFallbackState("openai/gpt-5.4")
    deps.sessionStates.set(sessionID, state)
    let abortCalls = 0
    let toastCalls = 0
    deps.ctx.client.tui.showToast = async () => {
      toastCalls += 1
      return {}
    }
    const helpers = createFallbackTimeoutHelpers(
      deps,
      async () => { abortCalls += 1 },
      async () => ({ accepted: false, status: "blocked", reason: "refused" }),
    )
    const clock = installRuntimeFallbackTestClock(0)

    helpers.scheduleSessionFallbackTimeout(sessionID)
    await clock.advanceBy(1)

    expect(abortCalls).toBe(1)
    expect(toastCalls).toBe(1)
  })
})
