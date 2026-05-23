/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import type { HookDeps, RuntimeFallbackPluginInput } from "./types"
import type { AutoRetryHelpers } from "./auto-retry"
import { createFallbackState } from "./fallback-state"
import { createSessionStatusHandler } from "./session-status-handler"
import { SessionCategoryRegistry } from "../../shared/session-category-registry"

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
      max_fallback_attempts: 4,
      cooldown_seconds: 60,
      timeout_seconds: 30,
      notify_on_fallback: false,
    },
    options: undefined,
    pluginConfig: {
      ...testPluginConfig,
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
    internallyAbortedSessions: new Set(),
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
    },
    resolveAgentForSessionFromContext: async () => undefined,
    cleanupStaleSessions: () => {},
  }
}

describe("createSessionStatusHandler", () => {
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

  it("#given top-level provider model fields with a variant #when session.status bootstraps fallback state #then it advances past the equivalent fallback", async () => {
    // given
    SessionCategoryRegistry.clear()
    const sessionID = "session-status-top-level-model-variant"
    SessionCategoryRegistry.register(sessionID, "test")

    const deps = createDeps()
    deps.pluginConfig = {
      ...testPluginConfig,
      categories: {
        test: {
          fallback_models: [
            { model: "github-copilot/claude-haiku-4.5", variant: "high" },
            "openai/gpt-5.4",
          ],
        },
      },
    }
    const abortCalls: string[] = []
    const retryCalls: Array<{ sessionID: string; model: string; source: string }> = []
    const handler = createSessionStatusHandler(deps, createHelpers(abortCalls, retryCalls), deps.sessionStatusRetryKeys)

    // when
    await handler({
      sessionID,
      providerID: "github-copilot",
      modelID: "claude-haiku-4.5",
      variant: "high",
      status: {
        type: "retry",
        attempt: 1,
        message: "All credentials for model claude-haiku-4.5 are cooling down [retrying in 7m 56s attempt #1]",
      },
    })

    // then
    expect(abortCalls).toEqual([sessionID])
    expect(deps.sessionStates.get(sessionID)?.originalModel).toBe("github-copilot/claude-haiku-4.5(high)")
    expect(retryCalls).toEqual([
      {
        sessionID,
        model: "openai/gpt-5.4",
        source: "session.status",
      },
    ])
    SessionCategoryRegistry.clear()
  })

  it("#given a model object and separate variant #when session.status bootstraps fallback state #then it advances past the equivalent fallback", async () => {
    // given
    SessionCategoryRegistry.clear()
    const sessionID = "session-status-mixed-model-variant"
    SessionCategoryRegistry.register(sessionID, "test")

    const deps = createDeps()
    deps.pluginConfig = {
      ...testPluginConfig,
      categories: {
        test: {
          fallback_models: [
            { model: "github-copilot/claude-haiku-4.5", variant: "high" },
            "openai/gpt-5.4",
          ],
        },
      },
    }
    const abortCalls: string[] = []
    const retryCalls: Array<{ sessionID: string; model: string; source: string }> = []
    const handler = createSessionStatusHandler(deps, createHelpers(abortCalls, retryCalls), deps.sessionStatusRetryKeys)

    // when
    await handler({
      sessionID,
      model: { providerID: "github-copilot", modelID: "claude-haiku-4.5" },
      variant: "high",
      status: {
        type: "retry",
        attempt: 1,
        message: "All credentials for model claude-haiku-4.5 are cooling down [retrying in 7m 56s attempt #1]",
      },
    })

    // then
    expect(abortCalls).toEqual([sessionID])
    expect(deps.sessionStates.get(sessionID)?.originalModel).toBe("github-copilot/claude-haiku-4.5(high)")
    expect(retryCalls).toEqual([
      {
        sessionID,
        model: "openai/gpt-5.4",
        source: "session.status",
      },
    ])
    SessionCategoryRegistry.clear()
  })

  it("#given an OpenCode id-shaped model object with variant #when session.status bootstraps fallback state #then it advances past the equivalent fallback", async () => {
    // given
    SessionCategoryRegistry.clear()
    const sessionID = "session-status-id-shaped-model-variant"
    SessionCategoryRegistry.register(sessionID, "test")

    const deps = createDeps()
    deps.pluginConfig = {
      ...testPluginConfig,
      categories: {
        test: {
          fallback_models: [
            { model: "github-copilot/claude-haiku-4.5", variant: "high" },
            "openai/gpt-5.4",
          ],
        },
      },
    }
    const abortCalls: string[] = []
    const retryCalls: Array<{ sessionID: string; model: string; source: string }> = []
    const handler = createSessionStatusHandler(deps, createHelpers(abortCalls, retryCalls), deps.sessionStatusRetryKeys)

    // when
    await handler({
      sessionID,
      model: { providerID: "github-copilot", id: "claude-haiku-4.5", variant: "high" },
      status: {
        type: "retry",
        attempt: 1,
        message: "All credentials for model claude-haiku-4.5 are cooling down [retrying in 7m 56s attempt #1]",
      },
    })

    // then
    expect(abortCalls).toEqual([sessionID])
    expect(deps.sessionStates.get(sessionID)?.originalModel).toBe("github-copilot/claude-haiku-4.5(high)")
    expect(retryCalls).toEqual([
      {
        sessionID,
        model: "openai/gpt-5.4",
        source: "session.status",
      },
    ])
    SessionCategoryRegistry.clear()
  })
})
