import { describe, expect, it } from "bun:test"
import type { HookDeps, RuntimeFallbackPluginInput } from "./types"
import type { AutoRetryHelpers } from "./auto-retry"
import { createFallbackState } from "./fallback-state"

const testPluginConfig = {
  git_master: {
    commit_footer: true,
    include_co_authored_by: true,
    git_env_prefix: "GIT_MASTER=1",
  },
}

type MessageUpdateHandlerModule = typeof import("./message-update-handler")

async function importFreshMessageUpdateHandlerModule(): Promise<MessageUpdateHandlerModule> {
  return import(`./message-update-handler?success-retry-key-${Date.now()}-${Math.random()}`)
}

function createContext(messagesResponse: unknown): RuntimeFallbackPluginInput {
  return {
    client: {
      session: {
        abort: async () => ({}),
        messages: async () => messagesResponse,
        promptAsync: async () => ({}),
      },
      tui: {
        showToast: async () => ({}),
      },
    },
    directory: "/test/dir",
  }
}

function createDeps(messagesResponse: unknown): HookDeps {
  return {
    ctx: createContext(messagesResponse),
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

function createHelpers(clearCalls: string[], autoRetryCalls: Array<{ sessionID: string; model: string; source: string }> = []): AutoRetryHelpers {
  return {
    abortSessionRequest: async () => {},
    clearSessionFallbackTimeout: (sessionID: string) => {
      clearCalls.push(sessionID)
    },
    scheduleSessionFallbackTimeout: () => {},
    autoRetryWithFallback: async (sessionID: string, model: string, _agent: string | undefined, source: string) => {
      autoRetryCalls.push({ sessionID, model, source })
    },
    resolveAgentForSessionFromContext: async () => "sisyphus",
    cleanupStaleSessions: () => {},
  }
}

describe("createMessageUpdateHandler retry-key cleanup", () => {
  it("#given a visible assistant reply after the latest user turn #when a non-error assistant update arrives #then the retry dedupe key is cleared with the fallback watchdog", async () => {
    // given
    const { createMessageUpdateHandler } = await importFreshMessageUpdateHandlerModule()
    const sessionID = "session-visible-assistant"
    const clearCalls: string[] = []
    const deps = createDeps({
      data: [
        { info: { role: "user" }, parts: [{ type: "text", text: "latest question" }] },
        { info: { role: "assistant" }, parts: [{ type: "text", text: "visible answer" }] },
      ],
    })
    const state = createFallbackState("google/gemini-2.5-pro")
    state.pendingFallbackModel = "openai/gpt-5.4"
    deps.sessionStates.set(sessionID, state)
    deps.sessionAwaitingFallbackResult.add(sessionID)
    deps.sessionStatusRetryKeys.set(sessionID, "retry:1")
    const handler = createMessageUpdateHandler(deps, createHelpers(clearCalls))

    // when
    await handler({
      info: {
        sessionID,
        role: "assistant",
        model: "openai/gpt-5.4",
      },
    })

    // then
    expect(deps.sessionAwaitingFallbackResult.has(sessionID)).toBe(false)
    expect(deps.sessionStatusRetryKeys.has(sessionID)).toBe(false)
    expect(state.pendingFallbackModel).toBeUndefined()
    expect(clearCalls).toEqual([sessionID])
  })

  it("#given an object-shaped pending fallback model #when message.updated errors for that model #then the fallback chain advances", async () => {
    // given
    const { createMessageUpdateHandler } = await importFreshMessageUpdateHandlerModule()
    const sessionID = "message-updated-object-model"
    const clearCalls: string[] = []
    const autoRetryCalls: Array<{ sessionID: string; model: string; source: string }> = []
    const deps = createDeps({ data: [] })
    deps.pluginConfig = {
      ...testPluginConfig,
      agents: {
        sisyphus: {
          fallback_models: ["github-copilot/claude-haiku-4.5", "openai/gpt-5.4"],
        },
      },
    }
    const state = createFallbackState("opencode-go/glm-5.1")
    state.currentModel = "github-copilot/claude-haiku-4.5"
    state.fallbackIndex = 0
    state.pendingFallbackModel = "github-copilot/claude-haiku-4.5"
    state.attemptCount = 1
    deps.sessionStates.set(sessionID, state)
    deps.sessionAwaitingFallbackResult.add(sessionID)
    const handler = createMessageUpdateHandler(deps, createHelpers(clearCalls, autoRetryCalls))

    // when
    await handler({
      info: {
        sessionID,
        role: "assistant",
        model: { providerID: "github-copilot", modelID: "claude-haiku-4.5" },
        error: { name: "RateLimitError", status: 429, message: "rate limit exceeded" },
      },
    })

    // then
    expect(deps.sessionAwaitingFallbackResult.has(sessionID)).toBe(false)
    expect(autoRetryCalls).toEqual([{ sessionID, model: "openai/gpt-5.4", source: "message.updated" }])
  })

  it("#given an object-shaped pending fallback model with a variant #when message.updated errors for that model #then the fallback chain advances", async () => {
    // given
    const { createMessageUpdateHandler } = await importFreshMessageUpdateHandlerModule()
    const sessionID = "message-updated-object-model-variant"
    const clearCalls: string[] = []
    const autoRetryCalls: Array<{ sessionID: string; model: string; source: string }> = []
    const deps = createDeps({ data: [] })
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
    const state = createFallbackState("opencode-go/glm-5.1")
    state.currentModel = "github-copilot/claude-haiku-4.5(high)"
    state.fallbackIndex = 0
    state.pendingFallbackModel = "github-copilot/claude-haiku-4.5(high)"
    state.attemptCount = 1
    deps.sessionStates.set(sessionID, state)
    deps.sessionAwaitingFallbackResult.add(sessionID)
    const handler = createMessageUpdateHandler(deps, createHelpers(clearCalls, autoRetryCalls))

    // when
    await handler({
      info: {
        sessionID,
        role: "assistant",
        model: { providerID: "github-copilot", modelID: "claude-haiku-4.5", variant: "high" },
        error: { name: "RateLimitError", status: 429, message: "rate limit exceeded" },
      },
    })

    // then
    expect(deps.sessionAwaitingFallbackResult.has(sessionID)).toBe(false)
    expect(autoRetryCalls).toEqual([{ sessionID, model: "openai/gpt-5.4", source: "message.updated" }])
  })

  it("#given a pending fallback model and mixed message model variant payload #when message.updated errors #then the fallback chain advances", async () => {
    // given
    const { createMessageUpdateHandler } = await importFreshMessageUpdateHandlerModule()
    const sessionID = "message-updated-mixed-model-variant"
    const clearCalls: string[] = []
    const autoRetryCalls: Array<{ sessionID: string; model: string; source: string }> = []
    const deps = createDeps({ data: [] })
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
    const state = createFallbackState("opencode-go/glm-5.1")
    state.currentModel = "github-copilot/claude-haiku-4.5(high)"
    state.fallbackIndex = 0
    state.pendingFallbackModel = "github-copilot/claude-haiku-4.5(high)"
    state.attemptCount = 1
    deps.sessionStates.set(sessionID, state)
    deps.sessionAwaitingFallbackResult.add(sessionID)
    const handler = createMessageUpdateHandler(deps, createHelpers(clearCalls, autoRetryCalls))

    // when
    await handler({
      info: {
        sessionID,
        role: "assistant",
        model: { providerID: "github-copilot", modelID: "claude-haiku-4.5" },
        variant: "high",
        error: { name: "RateLimitError", status: 429, message: "rate limit exceeded" },
      },
    })

    // then
    expect(deps.sessionAwaitingFallbackResult.has(sessionID)).toBe(false)
    expect(autoRetryCalls).toEqual([{ sessionID, model: "openai/gpt-5.4", source: "message.updated" }])
  })

  it("#given a top-level pending fallback model with a variant #when message.updated errors for that model #then the fallback chain advances", async () => {
    // given
    const { createMessageUpdateHandler } = await importFreshMessageUpdateHandlerModule()
    const sessionID = "message-updated-top-level-model-variant"
    const clearCalls: string[] = []
    const autoRetryCalls: Array<{ sessionID: string; model: string; source: string }> = []
    const deps = createDeps({ data: [] })
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
    const state = createFallbackState("opencode-go/glm-5.1")
    state.currentModel = "github-copilot/claude-haiku-4.5(high)"
    state.fallbackIndex = 0
    state.pendingFallbackModel = "github-copilot/claude-haiku-4.5(high)"
    state.attemptCount = 1
    deps.sessionStates.set(sessionID, state)
    deps.sessionAwaitingFallbackResult.add(sessionID)
    const handler = createMessageUpdateHandler(deps, createHelpers(clearCalls, autoRetryCalls))

    // when
    await handler({
      providerID: "github-copilot",
      modelID: "claude-haiku-4.5",
      variant: "high",
      info: {
        sessionID,
        role: "assistant",
        error: { name: "RateLimitError", status: 429, message: "rate limit exceeded" },
      },
    })

    // then
    expect(deps.sessionAwaitingFallbackResult.has(sessionID)).toBe(false)
    expect(autoRetryCalls).toEqual([{ sessionID, model: "openai/gpt-5.4", source: "message.updated" }])
  })
})
