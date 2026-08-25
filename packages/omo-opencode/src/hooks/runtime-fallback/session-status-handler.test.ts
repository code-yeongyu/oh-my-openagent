import { describe, expect, it } from "bun:test"
import { RUNTIME_FALLBACK_RETRYABLE_ERROR_PATTERNS } from "@oh-my-opencode/model-core"
import type { HookDeps, RuntimeFallbackPluginInput } from "./types"
import type { AutoRetryHelpers } from "./auto-retry"
import { RETRYABLE_ERROR_PATTERNS } from "./constants"
import { createFallbackState } from "./fallback-state"
import { createChatMessageHandler } from "./chat-message-handler"
import { createSessionStatusHandler } from "./session-status-handler"
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
      max_fallback_attempts: 4,
      cooldown_seconds: 60,
      timeout_seconds: 30,
      notify_on_fallback: false,
      restore_primary_after_cooldown: false,
    },
    options: undefined,
    pluginConfig: {
      git_master: {
        commit_footer: true,
        include_co_authored_by: true,
        git_env_prefix: "GIT_MASTER_",
      },
      categories: {
        test: {
          fallback_models: ["openai/gpt-5.4", "google/gemini-2.5-pro"],
        },
      },
    },
    sessionStates: new Map(),
    sessionLastAccess: new Map(),
    sessionRetryInFlight: new Set(),
    sessionAwaitingFallbackResult: new Set(),
    sessionFallbackTimeouts: new Map(),
    sessionStatusRetryKeys: new Map(),
  }
}

function createHelpers(abortCalls: string[], retryCalls: Array<{ sessionID: string; model: string; source: string }>): AutoRetryHelpers {
  return {
    abortSessionRequest: async (sessionID: string) => {
      abortCalls.push(sessionID)
    },
    clearSessionFallbackTimeout: () => {},
    scheduleSessionFallbackTimeout: () => {},
    autoRetryWithFallback: async (sessionID: string, model: string, _resolvedAgent: string | undefined, source: string) => {
      retryCalls.push({ sessionID, model, source })
      return { accepted: true, status: "dispatched" }
    },
    resolveAgentForSessionFromContext: async () => undefined,
    cleanupStaleSessions: () => {},
  }
}

describe("createSessionStatusHandler", () => {
  it("#given model-core retryable patterns #when the adapter status fallback patterns are loaded #then they share the canonical pattern set", () => {
    // given
    const canonicalPatterns = RUNTIME_FALLBACK_RETRYABLE_ERROR_PATTERNS

    // when
    const statusFallbackPatterns = RETRYABLE_ERROR_PATTERNS

    // then
    expect(statusFallbackPatterns).toBe(canonicalPatterns)
  })

  it("#given a free usage retry status #when the handler receives it #then it dispatches the fallback immediately", async () => {
    // given
    SessionCategoryRegistry.clear()
    const sessionID = "session-status-free-usage"
    SessionCategoryRegistry.register(sessionID, "test")

    const deps = createDeps()
    const abortCalls: string[] = []
    const retryCalls: Array<{ sessionID: string; model: string; source: string }> = []
    const handler = createSessionStatusHandler(deps, createHelpers(abortCalls, retryCalls), deps.sessionStatusRetryKeys)

    // when
    await handler({
      sessionID,
      model: "opencode/big-pickle",
      status: {
        type: "retry",
        attempt: 1,
        message: "Free usage exceeded, subscribe to Go",
      },
    })

    // then
    expect(abortCalls).toEqual([sessionID])
    expect(retryCalls).toEqual([
      {
        sessionID,
        model: "openai/gpt-5.4",
        source: "session.status",
      },
    ])
    expect(deps.sessionStatusRetryKeys.has(sessionID)).toBe(true)
    SessionCategoryRegistry.clear()
  })

  it("#given identical retry messages across models #when retries repeat #then same-model events dedupe and the new model advances", async () => {
    // given
    SessionCategoryRegistry.clear()
    const sessionID = "session-status-model-aware-dedup"
    SessionCategoryRegistry.register(sessionID, "test")

    const deps = createDeps()
    const abortCalls: string[] = []
    const retryCalls: Array<{ sessionID: string; model: string; source: string }> = []
    const handler = createSessionStatusHandler(deps, createHelpers(abortCalls, retryCalls), deps.sessionStatusRetryKeys)
    const status = {
      type: "retry",
      attempt: 1,
      message: "AI_APICallError: 5-hour usage limit reached",
    }

    // when
    await handler({
      sessionID,
      model: "opencode-go/glm-5.2",
      status,
    })
    await handler({
      sessionID,
      model: "opencode-go/glm-5.2",
      status,
    })
    await handler({
      sessionID,
      model: "openai/gpt-5.4",
      status,
    })

    // then
    expect(retryCalls).toEqual([
      {
        sessionID,
        model: "openai/gpt-5.4",
        source: "session.status",
      },
      {
        sessionID,
        model: "google/gemini-2.5-pro",
        source: "session.status",
      },
    ])
    SessionCategoryRegistry.clear()
  })

  it("#given interleaved retry statuses across models #when a stale model repeats #then every active model key remains deduped", async () => {
    // given
    SessionCategoryRegistry.clear()
    const sessionID = "session-status-interleaved-model-dedup"
    SessionCategoryRegistry.register(sessionID, "test")

    const deps = createDeps()
    const abortCalls: string[] = []
    const retryCalls: Array<{ sessionID: string; model: string; source: string }> = []
    const handler = createSessionStatusHandler(deps, createHelpers(abortCalls, retryCalls), deps.sessionStatusRetryKeys)
    const status = {
      type: "retry",
      attempt: 1,
      message: "AI_APICallError: 5-hour usage limit reached",
    }
    const firstModel = "opencode-go/glm-5.2"

    // when
    await handler({ sessionID, model: firstModel, status })
    await handler({ sessionID, model: "openai/gpt-5.4", status })
    await handler({ sessionID, model: firstModel, status })

    // then
    expect(abortCalls).toEqual([sessionID, sessionID])
    expect(retryCalls).toEqual([
      {
        sessionID,
        model: "openai/gpt-5.4",
        source: "session.status",
      },
      {
        sessionID,
        model: "google/gemini-2.5-pro",
        source: "session.status",
      },
    ])
    SessionCategoryRegistry.clear()
  })

  it("#given identical retry messages across variants #when retries repeat #then same-variant events dedupe and the new variant advances", async () => {
    // given
    SessionCategoryRegistry.clear()
    const sessionID = "session-status-variant-aware-dedup"
    SessionCategoryRegistry.register(sessionID, "test")

    const deps = createDeps()
    const abortCalls: string[] = []
    const retryCalls: Array<{ sessionID: string; model: string; source: string }> = []
    const handler = createSessionStatusHandler(deps, createHelpers(abortCalls, retryCalls), deps.sessionStatusRetryKeys)
    const status = {
      type: "retry",
      attempt: 1,
      message: "AI_APICallError: 5-hour usage limit reached",
    }
    const lowModel = { providerID: "opencode-go", modelID: "glm-5.2", variant: "low" }

    // when
    await handler({ sessionID, model: lowModel, status })
    await handler({ sessionID, model: "opencode-go/glm-5.2(low)", status })
    await handler({
      sessionID,
      model: { providerID: "opencode-go", modelID: "glm-5.2", variant: "high" },
      status,
    })

    // then
    expect(retryCalls).toEqual([
      {
        sessionID,
        model: "openai/gpt-5.4",
        source: "session.status",
      },
      {
        sessionID,
        model: "google/gemini-2.5-pro",
        source: "session.status",
      },
    ])
    SessionCategoryRegistry.clear()
  })

  it("#given repeated retry status without model metadata #when fallback mutates the current model #then the duplicate remains deduped", async () => {
    // given
    SessionCategoryRegistry.clear()
    const sessionID = "session-status-missing-model-dedup"
    SessionCategoryRegistry.register(sessionID, "test")

    const deps = createDeps()
    const abortCalls: string[] = []
    const retryCalls: Array<{ sessionID: string; model: string; source: string }> = []
    const state = createFallbackState("anthropic/claude-opus-4-7")
    deps.sessionStates.set(sessionID, state)
    const handler = createSessionStatusHandler(deps, createHelpers(abortCalls, retryCalls), deps.sessionStatusRetryKeys)
    const status = {
      type: "retry",
      attempt: 1,
      message: "AI_APICallError: 5-hour usage limit reached",
    }

    // when
    await handler({ sessionID, status })
    await handler({ sessionID, status })

    // then
    expect(abortCalls).toEqual([sessionID])
    expect(retryCalls).toEqual([
      {
        sessionID,
        model: "openai/gpt-5.4",
        source: "session.status",
      },
    ])
    expect(state.currentModel).toBe("openai/gpt-5.4")
    expect(state.pendingFallbackModel).toBe("openai/gpt-5.4")
    SessionCategoryRegistry.clear()
  })

  it("#given model-less retries in consecutive fallback generations #when the fallback genuinely fails #then the next model advances", async () => {
    // given
    SessionCategoryRegistry.clear()
    const sessionID = "session-status-missing-model-next-generation"
    SessionCategoryRegistry.register(sessionID, "test")

    const deps = createDeps()
    const abortCalls: string[] = []
    const retryCalls: Array<{ sessionID: string; model: string; source: string }> = []
    const state = createFallbackState("anthropic/claude-opus-4-7")
    deps.sessionStates.set(sessionID, state)
    const chatMessageHandler = createChatMessageHandler(deps)
    const helpers = createHelpers(abortCalls, retryCalls)
    helpers.autoRetryWithFallback = async (retrySessionID, retryModel, _resolvedAgent, source) => {
      retryCalls.push({ sessionID: retrySessionID, model: retryModel, source })
      const [providerID, ...modelParts] = retryModel.split("/")
      await chatMessageHandler(
        {
          sessionID: retrySessionID,
          model: {
            providerID,
            modelID: modelParts.join("/"),
          },
        },
        { message: {} },
      )
      return { accepted: true, status: "dispatched" }
    }
    const handler = createSessionStatusHandler(deps, helpers, deps.sessionStatusRetryKeys)
    const status = {
      type: "retry",
      attempt: 1,
      message: "AI_APICallError: 5-hour usage limit reached",
    }

    // when
    await handler({ sessionID, status })
    await handler({ sessionID, status })

    // then
    expect(retryCalls).toEqual([
      {
        sessionID,
        model: "openai/gpt-5.4",
        source: "session.status",
      },
      {
        sessionID,
        model: "google/gemini-2.5-pro",
        source: "session.status",
      },
    ])
    SessionCategoryRegistry.clear()
  })

  it("#given a no-timeout fallback dispatch is in flight #when the fallback retry status repeats after acknowledgement #then it advances instead of retaining the skipped key", async () => {
    // given
    SessionCategoryRegistry.clear()
    const sessionID = "session-status-in-flight-key-recovery"
    SessionCategoryRegistry.register(sessionID, "test")

    const deps = createDeps()
    deps.config.timeout_seconds = 0
    const abortCalls: string[] = []
    const retryCalls: Array<{ sessionID: string; model: string; source: string }> = []
    const helpers = createHelpers(abortCalls, retryCalls)
    const retryStarted = Promise.withResolvers<void>()
    const releaseFirstRetry = Promise.withResolvers<void>()
    let firstRetry = true
    helpers.autoRetryWithFallback = async (retrySessionID, retryModel, _resolvedAgent, source) => {
      retryCalls.push({ sessionID: retrySessionID, model: retryModel, source })
      if (firstRetry) {
        firstRetry = false
        deps.sessionRetryInFlight.add(retrySessionID)
        retryStarted.resolve()
        await releaseFirstRetry.promise
        deps.sessionRetryInFlight.delete(retrySessionID)
      }
      return { accepted: true, status: "dispatched" }
    }
    const handler = createSessionStatusHandler(deps, helpers, deps.sessionStatusRetryKeys)
    const fallbackRetryStatus = {
      type: "retry",
      attempt: 1,
      message: "AI_APICallError: 5-hour usage limit reached",
    }

    // when
    const firstStatus = handler({
      sessionID,
      model: "anthropic/claude-opus-4-7",
      status: fallbackRetryStatus,
    })
    await retryStarted.promise
    await handler({
      sessionID,
      model: "openai/gpt-5.4",
      status: fallbackRetryStatus,
    })
    releaseFirstRetry.resolve()
    await firstStatus
    await createChatMessageHandler(deps)(
      {
        sessionID,
        model: { providerID: "openai", modelID: "gpt-5.4" },
      },
      { message: {} },
    )
    await handler({
      sessionID,
      model: "openai/gpt-5.4",
      status: fallbackRetryStatus,
    })

    // then
    expect(abortCalls).toEqual([sessionID, sessionID])
    expect(retryCalls).toEqual([
      {
        sessionID,
        model: "openai/gpt-5.4",
        source: "session.status",
      },
      {
        sessionID,
        model: "google/gemini-2.5-pro",
        source: "session.status",
      },
    ])
    SessionCategoryRegistry.clear()
  })

  it("#given a first retry status arrives during an in-flight fallback #when the identical status repeats after the in-flight marker clears #then the first key was not retained", async () => {
    // given
    SessionCategoryRegistry.clear()
    const sessionID = "session-status-first-in-flight-key"
    SessionCategoryRegistry.register(sessionID, "test")
    const deps = createDeps()
    deps.config.timeout_seconds = 0
    deps.sessionStates.set(sessionID, createFallbackState("anthropic/claude-opus-4-7"))
    deps.sessionRetryInFlight.add(sessionID)
    const abortCalls: string[] = []
    const retryCalls: Array<{ sessionID: string; model: string; source: string }> = []
    const handler = createSessionStatusHandler(deps, createHelpers(abortCalls, retryCalls), deps.sessionStatusRetryKeys)
    const status = {
      type: "retry",
      attempt: 1,
      message: "AI_APICallError: 5-hour usage limit reached",
    }

    // when
    await handler({ sessionID, model: "anthropic/claude-opus-4-7", status })

    // then
    expect(deps.sessionStatusRetryKeys.has(sessionID)).toBe(false)

    // when
    deps.sessionRetryInFlight.delete(sessionID)
    await handler({ sessionID, model: "anthropic/claude-opus-4-7", status })

    // then
    expect(abortCalls).toEqual([sessionID])
    expect(retryCalls).toEqual([
      {
        sessionID,
        model: "openai/gpt-5.4",
        source: "session.status",
      },
    ])
    SessionCategoryRegistry.clear()
  })

  it("#given pending fallback prompt may already be accepted #when provider retry status arrives #then it keeps waiting for that accepted prompt", async () => {
    // given
    SessionCategoryRegistry.clear()
    const sessionID = "session-status-ambiguous-pending"
    SessionCategoryRegistry.register(sessionID, "test")

    const deps = createDeps()
    const abortCalls: string[] = []
    const retryCalls: Array<{ sessionID: string; model: string; source: string }> = []
    const state = createFallbackState("anthropic/claude-opus-4-7")
    state.currentModel = "openai/gpt-5.4"
    state.fallbackIndex = 0
    state.attemptCount = 1
    state.pendingFallbackModel = "openai/gpt-5.4"
    state.pendingFallbackPromptMayHaveBeenAccepted = true
    deps.sessionStates.set(sessionID, state)

    const handler = createSessionStatusHandler(deps, createHelpers(abortCalls, retryCalls), deps.sessionStatusRetryKeys)

    // when
    await handler({
      sessionID,
      model: "openai/gpt-5.4",
      status: {
        type: "retry",
        attempt: 2,
        message: "All credentials for model gpt-5.4 are cooling down [retrying in 7m 56s attempt #2]",
      },
    })

    // then
    expect(abortCalls).toEqual([])
    expect(retryCalls).toEqual([])
    expect(state.currentModel).toBe("openai/gpt-5.4")
    expect(state.pendingFallbackModel).toBe("openai/gpt-5.4")
    expect(state.pendingFallbackPromptMayHaveBeenAccepted).toBe(true)
    SessionCategoryRegistry.clear()
  })

  it("#given a pending fallback model #when a new provider cooldown retry arrives #then the handler overrides the pending fallback and advances the chain", async () => {
    // given
    SessionCategoryRegistry.clear()
    const sessionID = "session-status-pending-fallback"
    SessionCategoryRegistry.register(sessionID, "test")

    const deps = createDeps()
    const abortCalls: string[] = []
    const retryCalls: Array<{ sessionID: string; model: string; source: string }> = []
    const state = createFallbackState("anthropic/claude-opus-4-7")
    state.currentModel = "openai/gpt-5.4"
    state.fallbackIndex = 0
    state.attemptCount = 1
    state.pendingFallbackModel = "openai/gpt-5.4"
    state.failedModels.set("anthropic/claude-opus-4-7", Date.now())
    deps.sessionStates.set(sessionID, state)

    const handler = createSessionStatusHandler(deps, createHelpers(abortCalls, retryCalls), deps.sessionStatusRetryKeys)

    // when
    await handler({
      sessionID,
      model: "openai/gpt-5.4",
      status: {
        type: "retry",
        attempt: 2,
        message: "All credentials for model gpt-5.4 are cooling down [retrying in 7m 56s attempt #2]",
      },
    })

    // then
    expect(abortCalls).toEqual([sessionID])
    expect(retryCalls).toEqual([
      {
        sessionID,
        model: "google/gemini-2.5-pro",
        source: "session.status",
      },
    ])
    expect(state.currentModel).toBe("google/gemini-2.5-pro")
    expect(state.pendingFallbackModel).toBe("google/gemini-2.5-pro")
    SessionCategoryRegistry.clear()
  })
})
