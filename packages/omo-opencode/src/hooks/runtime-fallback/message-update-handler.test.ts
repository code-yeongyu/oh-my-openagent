import { afterEach, describe, expect, it } from "bun:test"
import type { AutoRetryHelpers } from "./auto-retry"
import { createMessageUpdateHandler } from "./message-update-handler"
import { createEventHandler } from "./event-handler"
import { createFallbackState } from "./fallback-state"
import type { HookDeps, RuntimeFallbackPluginInput } from "./types"
import { hasVisibleAssistantResponse } from "./visible-assistant-response"
import { extractAutoRetrySignal } from "./error-classifier"
import { SessionCategoryRegistry } from "../../shared/session-category-registry"

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

describe("hasVisibleAssistantResponse", () => {
  it("#given only an old assistant reply before the latest user turn #when visibility is checked #then the stale reply is ignored", async () => {
    // given
    const checkVisibleResponse = hasVisibleAssistantResponse(() => undefined)
    const ctx = createContext({
      data: [
        { info: { role: "user" }, parts: [{ type: "text", text: "older question" }] },
        { info: { role: "assistant" }, parts: [{ type: "text", text: "older answer" }] },
        { info: { role: "user" }, parts: [{ type: "text", text: "latest question" }] },
      ],
    })

    // when
    const result = await checkVisibleResponse(ctx, "session-old-assistant", undefined)

    // then
    expect(result).toBe(false)
  })

  it("#given an assistant reply after the latest user turn #when visibility is checked #then the current reply is treated as visible", async () => {
    // given
    const checkVisibleResponse = hasVisibleAssistantResponse(() => undefined)
    const ctx = createContext({
      data: [
        { info: { role: "user" }, parts: [{ type: "text", text: "latest question" }] },
        { info: { role: "assistant" }, parts: [{ type: "text", text: "visible answer" }] },
      ],
    })

    // when
    const result = await checkVisibleResponse(ctx, "session-visible-assistant", undefined)

    // then
    expect(result).toBe(true)
  })

  it("#given a too-many-requests assistant reply #when visibility is checked #then it is treated as an auto-retry signal", async () => {
    // given
    const checkVisibleResponse = hasVisibleAssistantResponse(extractAutoRetrySignal)
    const ctx = createContext({
      data: [
        { info: { role: "user" }, parts: [{ type: "text", text: "latest question" }] },
        {
          info: { role: "assistant" },
          parts: [
            {
              type: "text",
              text: "Too Many Requests: Sorry, you've exhausted this model's rate limit. Please try a different model.",
            },
          ],
        },
      ],
    })

    // when
    const result = await checkVisibleResponse(ctx, "session-rate-limit", undefined)

    // then
    expect(result).toBe(false)
  })
})

function createRuntimeFallbackContext(operations: string[]): RuntimeFallbackPluginInput {
  return {
    client: {
      session: {
        abort: async () => ({}),
        messages: async () => ({ data: [] }),
        promptAsync: async () => ({}),
      },
      tui: {
        showToast: async () => {
          operations.push("toast")
          return {}
        },
      },
    },
    directory: "/test/dir",
  }
}

function createRuntimeFallbackDeps(operations: string[]): HookDeps {
  return {
    ctx: createRuntimeFallbackContext(operations),
    config: {
      enabled: true,
      retry_on_errors: [429, 503, 529],
      max_fallback_attempts: 3,
      cooldown_seconds: 60,
      timeout_seconds: 30,
      notify_on_fallback: true,
      restore_primary_after_cooldown: false,
    },
    options: undefined,
    pluginConfig: {
      categories: {
        test: {
          fallback_models: ["litellm/openai.eu.gpt-5.5"],
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

function createRuntimeFallbackHelpers(deps: HookDeps, operations: string[]): AutoRetryHelpers {
  return {
    abortSessionRequest: async (_sessionID: string, source: string) => {
      operations.push(`abort:${source}`)
      if (source === "message.updated.quota-fallback") {
        deps.internallyAbortedSessions.add(_sessionID)
      }
    },
    clearSessionFallbackTimeout: () => {},
    scheduleSessionFallbackTimeout: () => {},
    autoRetryWithFallback: async (_sessionID: string, model: string) => {
      operations.push(`retry:${model}`)
      return { accepted: true, status: "dispatched" }
    },
    resolveAgentForSessionFromContext: async () => undefined,
    cleanupStaleSessions: () => {},
  }
}

describe("createMessageUpdateHandler runtime fallback dispatch", () => {
  afterEach(() => {
    SessionCategoryRegistry.clear()
  })

  it("#given quota-exceeded assistant error with a fallback #when message update is handled #then primary request is aborted before fallback dispatch and toast", async () => {
    // given
    const sessionID = "session-quota-fallback"
    const operations: string[] = []
    SessionCategoryRegistry.register(sessionID, "test")
    const deps = createRuntimeFallbackDeps(operations)
    const handler = createMessageUpdateHandler(deps, createRuntimeFallbackHelpers(deps, operations))

    // when
    await handler({
      sessionID,
      info: {
        role: "assistant",
        model: "openai/gpt-5.4",
        error: {
          name: "ProviderRateLimitError",
          message: "The usage limit has been reached for this model.",
        },
      },
    })

    // then
    expect(operations).toEqual([
      "abort:message.updated.quota-fallback",
      "retry:litellm/openai.eu.gpt-5.5",
      "toast",
    ])
    expect(deps.internallyAbortedSessions.has(sessionID)).toBe(true)
  })

  it("#given a watchdog abort completed through a visible fallback response #when the user later cancels #then the stale internal-abort marker does not preserve retry state", async () => {
    const sessionID = "session-watchdog-fallback-complete"
    const operations: string[] = []
    const deps = createRuntimeFallbackDeps(operations)
    const state = createFallbackState("openai/primary")
    state.currentModel = "openai/fallback"
    state.fallbackIndex = 0
    state.attemptCount = 1
    state.pendingFallbackModel = "openai/fallback"
    deps.sessionStates.set(sessionID, state)
    deps.sessionAwaitingFallbackResult.add(sessionID)
    deps.internallyAbortedSessions.add(sessionID)
    deps.ctx.client.session.messages = async () => ({
      data: [
        { info: { role: "user" }, parts: [{ type: "text", text: "latest question" }] },
        { info: { role: "assistant" }, parts: [{ type: "text", text: "fallback answer" }] },
      ],
    })
    const helpers = createRuntimeFallbackHelpers(deps, operations)
    const messageHandler = createMessageUpdateHandler(deps, helpers)
    const eventHandler = createEventHandler(deps, helpers)

    await messageHandler({
      sessionID,
      info: { role: "assistant", model: "openai/fallback" },
      parts: [{ type: "text", text: "fallback answer" }],
    })
    await messageHandler({
      sessionID,
      info: { role: "user" },
      parts: [{ type: "text", text: "next question" }],
    })
    await eventHandler({
      event: {
        type: "session.error",
        properties: { sessionID, error: { name: "MessageAbortedError" } },
      },
    })

    expect(deps.internallyAbortedSessions.has(sessionID)).toBe(false)
    expect(deps.sessionStates.get(sessionID)?.currentModel).toBe("openai/primary")
    expect(deps.sessionStates.get(sessionID)?.attemptCount).toBe(0)
  })
})
