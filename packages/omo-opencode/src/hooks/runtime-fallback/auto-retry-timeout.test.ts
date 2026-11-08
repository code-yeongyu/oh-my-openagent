import { afterEach, describe, expect, test } from "bun:test"

import { createFallbackTimeoutHelpers } from "./auto-retry-timeout"
import { createFallbackState } from "./fallback-state"
import type { HookDeps, RuntimeFallbackPluginInput } from "./types"
import { SessionCategoryRegistry } from "../../shared/session-category-registry"
import { installRuntimeFallbackTestClock, restoreRuntimeFallbackTestClock } from "./test-timeout-clock.test-support"
import { clearAllCompactions, isCompactionInFlight, recordCompactionEnd, recordCompactionStart } from "../../shared/compaction-in-flight"

type ToastCall = {
  readonly title: string
  readonly message: string
  readonly variant: string
}

function createContext(toasts: ToastCall[] = [], showToast?: RuntimeFallbackPluginInput["client"]["tui"]["showToast"]): RuntimeFallbackPluginInput {
  return {
    client: {
      session: {
        abort: async () => ({}),
        messages: async () => ({ data: [] }),
        promptAsync: async () => ({}),
      },
      tui: {
        showToast: showToast ?? (async (input) => {
          toasts.push({
            title: input.body.title,
            message: input.body.message,
            variant: input.body.variant,
          })
          return {}
        }),
      },
    },
    directory: "/test/dir",
  }
}

function createDeps(toasts: ToastCall[] = [], showToast?: RuntimeFallbackPluginInput["client"]["tui"]["showToast"]): HookDeps {
  return {
    ctx: createContext(toasts, showToast),
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

  test("#given timeout fallback dispatch is blocked #when the timeout fires #then fallback state is restored with the attempt consumed", async () => {
    // given
    const sessionID = "session-timeout-dispatch-blocked"
    SessionCategoryRegistry.register(sessionID, "test")
    const deps = createDeps()
    const state = createFallbackState("openai/gpt-5.4")
    deps.sessionStates.set(sessionID, state)

    let retryModel: string | undefined
    const helpers = createFallbackTimeoutHelpers(
      deps,
      async () => {},
      async (_sessionID, model) => {
        retryModel = model
        return { accepted: false, status: "blocked", reason: "test gate blocked dispatch" }
      },
    )
    const clock = installRuntimeFallbackTestClock()

    // when
    helpers.scheduleSessionFallbackTimeout(sessionID)
    await clock.advanceBy(1)

    // then
    expect(retryModel).toBe("litellm/openai.eu.gpt-5.5")
    expect(state.currentModel).toBe("openai/gpt-5.4")
    expect(state.fallbackIndex).toBe(-1)
    expect(state.attemptCount).toBe(1)
    expect(state.pendingFallbackModel).toBe(undefined)
    expect(state.failedModels.size).toBe(0)
  })

  test("#given an accepted fallback is awaiting its result #when timeout escalation is blocked below the cap #then the restored awaiting state keeps a timeout armed", async () => {
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

    let dispatchCount = 0
    const helpers = createFallbackTimeoutHelpers(
      deps,
      async () => {},
      async () => {
        dispatchCount += 1
        return { accepted: false, status: "blocked", reason: "test gate blocked dispatch" }
      },
    )
    const clock = installRuntimeFallbackTestClock()

    // when
    helpers.scheduleSessionFallbackTimeout(sessionID)
    await clock.advanceBy(1)

    // then
    expect(dispatchCount).toBe(1)
    expect(state.attemptCount).toBe(1)
    expect(deps.sessionAwaitingFallbackResult.has(sessionID)).toBe(true)
    expect(deps.sessionFallbackTimeouts.has(sessionID)).toBe(true)
    helpers.clearSessionFallbackTimeout(sessionID)
  })

  test("#given every timeout dispatch is rejected #when the attempt cap is reached #then retries stop and the caller sees a terminal failure", async () => {
    // given
    const sessionID = "session-timeout-rejected-until-cap"
    SessionCategoryRegistry.register(sessionID, "test")
    const toasts: ToastCall[] = []
    const deps = createDeps(toasts)
    deps.config.max_fallback_attempts = 2
    const state = createFallbackState("openai/gpt-5.4")
    deps.sessionStates.set(sessionID, state)
    deps.sessionAwaitingFallbackResult.add(sessionID)

    let dispatchCount = 0
    const abortSources: string[] = []
    const helpers = createFallbackTimeoutHelpers(
      deps,
      async (_sessionID, source) => {
        abortSources.push(source)
      },
      async () => {
        dispatchCount += 1
        return { accepted: false, status: "blocked", reason: `blocked ${dispatchCount}` }
      },
    )
    const clock = installRuntimeFallbackTestClock()

    // when
    helpers.scheduleSessionFallbackTimeout(sessionID)
    await clock.advanceBy(10)

    // then
    expect(dispatchCount).toBe(2)
    expect(state.attemptCount).toBe(2)
    expect(state.currentModel).toBe("openai/gpt-5.4")
    expect(state.fallbackIndex).toBe(-1)
    expect(deps.sessionAwaitingFallbackResult.has(sessionID)).toBe(false)
    expect(deps.sessionFallbackTimeouts.has(sessionID)).toBe(false)
    expect(abortSources).toEqual([
      "session.timeout",
      "session.timeout",
      "session.timeout.fallback-exhausted",
    ])
    expect(toasts).toEqual([
      {
        title: "Model Fallback Failed",
        message: "No fallback model could be reached (max fallback attempts reached)",
        variant: "error",
      },
    ])
  })

  test("#given no fallback models are configured #when the timeout fires #then the awaiting caller is released terminally", async () => {
    // given
    const sessionID = "session-timeout-without-fallback-models"
    const toasts: ToastCall[] = []
    const deps = createDeps(toasts)
    deps.pluginConfig = { categories: {} }
    deps.sessionStates.set(sessionID, createFallbackState("openai/gpt-5.4"))
    deps.sessionAwaitingFallbackResult.add(sessionID)

    let dispatchCount = 0
    const abortSources: string[] = []
    const helpers = createFallbackTimeoutHelpers(
      deps,
      async (_sessionID, source) => {
        abortSources.push(source)
      },
      async () => {
        dispatchCount += 1
        return { accepted: true, status: "dispatched" }
      },
    )
    const clock = installRuntimeFallbackTestClock()

    // when
    helpers.scheduleSessionFallbackTimeout(sessionID)
    await clock.advanceBy(10)

    // then
    expect(dispatchCount).toBe(0)
    expect(deps.sessionAwaitingFallbackResult.has(sessionID)).toBe(false)
    expect(deps.sessionFallbackTimeouts.has(sessionID)).toBe(false)
    expect(abortSources).toEqual(["session.timeout.fallback-exhausted"])
    expect(toasts[0]?.message).toBe("No fallback model could be reached (no fallback models configured)")
  })

  test("#given no session is awaiting a fallback result #when the fallback budget is exhausted #then no terminal abort is issued and the user is warned once", async () => {
    // given
    const sessionID = "session-timeout-exhausted-without-awaiting"
    SessionCategoryRegistry.register(sessionID, "test")
    const toasts: ToastCall[] = []
    const deps = createDeps(toasts)
    deps.config.max_fallback_attempts = 1
    const state = createFallbackState("openai/gpt-5.4")
    state.attemptCount = 1
    deps.sessionStates.set(sessionID, state)

    const abortSources: string[] = []
    const helpers = createFallbackTimeoutHelpers(
      deps,
      async (abortedSessionID, source) => {
        abortSources.push(source)
        if (source === "session.timeout") {
          deps.internallyAbortedSessions.add(abortedSessionID)
        }
      },
      async () => ({ accepted: true, status: "dispatched" }),
    )
    const clock = installRuntimeFallbackTestClock()

    // when
    helpers.scheduleSessionFallbackTimeout(sessionID)
    await clock.advanceBy(10)

    // then
    expect(abortSources).toEqual(["session.timeout"])
    expect(toasts).toEqual([
      { title: "Runtime fallback", message: "Runtime fallback could not prepare a replacement", variant: "warning" },
    ])
    expect(deps.sessionFallbackTimeouts.has(sessionID)).toBe(false)
    expect(deps.internallyAbortedSessions.has(sessionID)).toBe(false)
  })

  test("#given every remaining fallback model is cooling down below the attempt cap #when the watchdog expires #then the caller is told no fallback model is available", async () => {
    // given
    const sessionID = "session-timeout-all-fallbacks-cooling"
    SessionCategoryRegistry.register(sessionID, "test")
    const toasts: ToastCall[] = []
    const deps = createDeps(toasts)
    const state = createFallbackState("openai/gpt-5.4")
    state.failedModels.set("litellm/openai.eu.gpt-5.5", Date.now())
    state.failedModels.set("google/gemini-2.5-pro", Date.now())
    deps.sessionStates.set(sessionID, state)
    deps.sessionAwaitingFallbackResult.add(sessionID)
    const helpers = createFallbackTimeoutHelpers(deps, async () => {}, async () => ({ accepted: true, status: "dispatched" }))
    const clock = installRuntimeFallbackTestClock()

    // when
    helpers.scheduleSessionFallbackTimeout(sessionID)
    await clock.advanceBy(10)

    // then
    expect(state.attemptCount).toBeLessThan(deps.config.max_fallback_attempts)
    expect(toasts.map((toast) => toast.message)).toEqual(["No fallback model could be reached (no available fallback models)"])
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

  test("#given the watchdog toast never settles #when the compaction budget is exhausted #then ownership is released first and the abort is a real cancellation", async () => {
    // given
    const sessionID = "session-timeout-compaction-budget-stuck-toast"
    SessionCategoryRegistry.register(sessionID, "test")
    const deps = createDeps([], () => new Promise(() => {}))
    deps.options = { session_timeout_ms: 30_000 }
    deps.sessionStates.set(sessionID, createFallbackState("openai/gpt-5.4"))
    deps.sessionAwaitingFallbackResult.add(sessionID)
    deps.sessionRetryInFlight.add(sessionID)
    const seenAtAbort: { readonly source: string; readonly awaiting: boolean; readonly retrying: boolean }[] = []
    const helpers = createFallbackTimeoutHelpers(
      deps,
      async (abortedSessionID, source) => {
        seenAtAbort.push({
          source,
          awaiting: deps.sessionAwaitingFallbackResult.has(abortedSessionID),
          retrying: deps.sessionRetryInFlight.has(abortedSessionID),
        })
      },
      async () => ({ accepted: true, status: "dispatched" }),
    )
    const clock = installRuntimeFallbackTestClock(0)
    recordCompactionStart(sessionID)

    // when
    helpers.scheduleSessionFallbackTimeout(sessionID)
    await clock.advanceBy(600_000)

    // then
    expect(seenAtAbort).toEqual([{ source: "session.timeout.fallback-exhausted", awaiting: false, retrying: false }])
    expect(deps.sessionAwaitingFallbackResult.has(sessionID)).toBe(false)
    expect(deps.sessionRetryInFlight.has(sessionID)).toBe(false)
    expect(deps.internallyAbortedSessions.has(sessionID)).toBe(false)
    expect(deps.sessionFallbackTimeouts.has(sessionID)).toBe(false)
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

  test("#given a superseding retry advances the same state object while a timeout dispatch is in flight #when that dispatch is rejected #then the newer retry is not rolled back", async () => {
    // given
    const sessionID = "session-timeout-superseded-in-flight"
    SessionCategoryRegistry.register(sessionID, "test")
    const deps = createDeps()
    const state = createFallbackState("openai/gpt-5.4")
    deps.sessionStates.set(sessionID, state)
    deps.sessionAwaitingFallbackResult.add(sessionID)

    let dispatchCount = 0
    const helpers = createFallbackTimeoutHelpers(
      deps,
      async () => {},
      async () => {
        dispatchCount += 1
        // A concurrent retry advances the very same FallbackState object without
        // replacing it, so an identity-only guard would still consider this
        // rejected dispatch the owner and rewind the newer retry.
        state.currentModel = "google/gemini-2.5-pro"
        state.fallbackIndex = 1
        state.attemptCount = 7
        return { accepted: false, status: "blocked", reason: "test gate blocked dispatch" }
      },
    )
    const clock = installRuntimeFallbackTestClock()

    // when
    helpers.scheduleSessionFallbackTimeout(sessionID)
    await clock.advanceBy(10)

    // then
    expect(dispatchCount).toBe(1)
    expect(state.currentModel).toBe("google/gemini-2.5-pro")
    expect(state.fallbackIndex).toBe(1)
    expect(state.attemptCount).toBe(7)
  })

  test("#given the notify toast never settles #when the fallback budget is exhausted #then the terminal abort still fires", async () => {
    // given
    const sessionID = "session-timeout-toast-never-settles"
    SessionCategoryRegistry.register(sessionID, "test")
    const deps = createDeps([], () => new Promise(() => {}))
    deps.config.max_fallback_attempts = 1
    const state = createFallbackState("openai/gpt-5.4")
    state.attemptCount = 1
    deps.sessionStates.set(sessionID, state)
    deps.sessionAwaitingFallbackResult.add(sessionID)

    const abortSources: string[] = []
    const helpers = createFallbackTimeoutHelpers(
      deps,
      async (_sessionID, source) => {
        abortSources.push(source)
      },
      async () => ({ accepted: true, status: "dispatched" }),
    )
    const clock = installRuntimeFallbackTestClock()

    // when
    helpers.scheduleSessionFallbackTimeout(sessionID)
    await clock.advanceBy(10)

    // then
    expect(abortSources).toContain("session.timeout.fallback-exhausted")
  })

  test("#given a newer fallback generation replaces the session state during the fire-and-forget toast dispatch #when the terminal abort would fire #then it does not abort the newer generation", async () => {
    // given
    // showToast is invoked but not awaited, so its body still runs
    // synchronously up to its own first await - the same window a
    // synchronous side effect from a concurrent caller could land in.
    const sessionID = "session-timeout-terminal-abort-superseded"
    SessionCategoryRegistry.register(sessionID, "test")
    let replacementState: ReturnType<typeof createFallbackState> | undefined
    const deps = createDeps([], () => {
      replacementState = createFallbackState("google/gemini-2.5-pro")
      deps.sessionStates.set(sessionID, replacementState)
      return new Promise(() => {})
    })
    deps.config.max_fallback_attempts = 1
    const state = createFallbackState("openai/gpt-5.4")
    state.attemptCount = 1
    deps.sessionStates.set(sessionID, state)
    deps.sessionAwaitingFallbackResult.add(sessionID)

    const abortSources: string[] = []
    const helpers = createFallbackTimeoutHelpers(
      deps,
      async (_sessionID, source) => {
        abortSources.push(source)
      },
      async () => ({ accepted: true, status: "dispatched" }),
    )
    const clock = installRuntimeFallbackTestClock()

    // when
    helpers.scheduleSessionFallbackTimeout(sessionID)
    await clock.advanceBy(10)

    // then
    expect(replacementState).toBeDefined()
    expect(abortSources).not.toContain("session.timeout.fallback-exhausted")
    expect(deps.sessionStates.get(sessionID)).toBe(replacementState)
  })
})
