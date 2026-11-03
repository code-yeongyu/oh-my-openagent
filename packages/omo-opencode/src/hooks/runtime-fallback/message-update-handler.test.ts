import { afterEach, describe, expect, it } from "bun:test"
import type { AutoRetryHelpers } from "./auto-retry"
import { createMessageUpdateHandler } from "./message-update-handler"
import type { HookDeps, RuntimeFallbackPluginInput } from "./types"
import { hasVisibleAssistantResponse } from "./visible-assistant-response"
import { extractAutoRetrySignal } from "./error-classifier"
import { SessionCategoryRegistry } from "../../shared/session-category-registry"
import { createFallbackState } from "./fallback-state"

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
  for (const text of [
    "Done. I added a content filter toggle to the settings page.",
    "The Azure response includes content_filter_results; I now parse them.",
  ]) {
    it(`counts a completed reply mentioning filtering as visible: ${text}`, async () => {
      const checkVisibleResponse = hasVisibleAssistantResponse(extractAutoRetrySignal)
      const ctx = createContext({
        data: [
          { info: { role: "user" }, parts: [{ type: "text", text: "Update the settings page." }] },
          { info: { role: "assistant" }, parts: [{ type: "text", text }] },
        ],
      })

      expect(await checkVisibleResponse(ctx, "session-content-filter-answer", undefined)).toBe(true)
    })
  }

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

  it("clears the fallback timeout after a completed answer mentioning content filters", async () => {
    const sessionID = "session-content-filter-answer"
    const operations: string[] = []
    const deps = createRuntimeFallbackDeps(operations)
    deps.ctx = createContext({
      data: [
        { info: { role: "user" }, parts: [{ type: "text", text: "Update the settings page." }] },
        {
          info: { role: "assistant" },
          parts: [{ type: "text", text: "Done. I added a content filter toggle to the settings page." }],
        },
      ],
    })
    const state = createFallbackState("openai/primary")
    state.currentModel = "openai/current"
    state.pendingFallbackModel = "openai/current"
    deps.sessionStates.set(sessionID, state)
    deps.sessionAwaitingFallbackResult.add(sessionID)
    deps.sessionFallbackTimeouts.set(sessionID, 1)
    const helpers = createRuntimeFallbackHelpers(deps, operations)
    helpers.clearSessionFallbackTimeout = () => {
      operations.push("clear-timeout")
      deps.sessionFallbackTimeouts.delete(sessionID)
    }
    const handler = createMessageUpdateHandler(deps, helpers)

    await handler({ sessionID, info: { role: "assistant", model: "openai/current" } })

    expect(operations).toEqual(["clear-timeout"])
    expect(deps.sessionFallbackTimeouts.has(sessionID)).toBe(false)
    expect(deps.sessionAwaitingFallbackResult.has(sessionID)).toBe(false)
    expect(state.pendingFallbackModel).toBeUndefined()
  })

  it.each([0, 30])("interrupts a real ContentFilterError during an active retry with timeout %i", async (timeoutSeconds) => {
    const sessionID = "session-content-filter-signal"
    const operations: string[] = []
    const deps = createRuntimeFallbackDeps(operations)
    deps.config.timeout_seconds = timeoutSeconds
    deps.pluginConfig = {
      categories: {
        test: {
          fallback_models: ["openai/primary", "openai/current", "openai/next"],
        },
      },
    }
    SessionCategoryRegistry.register(sessionID, "test")
    const state = createFallbackState("openai/primary")
    state.currentModel = "openai/current"
    state.pendingFallbackModel = "openai/current"
    state.fallbackIndex = 1
    state.attemptCount = 1
    deps.sessionStates.set(sessionID, state)
    deps.sessionRetryInFlight.add(sessionID)
    deps.sessionAwaitingFallbackResult.add(sessionID)
    const handler = createMessageUpdateHandler(deps, createRuntimeFallbackHelpers(deps, operations))

    await handler({
      sessionID,
      info: {
        role: "assistant",
        model: "openai/current",
        error: {
          name: "ContentFilterError",
          data: { message: "Blocked by the provider's content management policy." },
        },
      },
    })

    expect(operations).toEqual([
      "abort:message.updated.retry-signal",
      "retry:openai/next",
      "toast",
    ])
    expect(deps.sessionRetryInFlight.has(sessionID)).toBe(false)
    expect(deps.sessionAwaitingFallbackResult.has(sessionID)).toBe(false)
    expect(state.currentModel).toBe("openai/next")
    expect(state.pendingFallbackModel).toBe("openai/next")
    expect(state.attemptCount).toBe(2)
  })

  it("ignores a stale ContentFilterError from an older model while a newer retry is active", async () => {
    const sessionID = "session-stale-content-filter-error"
    const operations: string[] = []
    const deps = createRuntimeFallbackDeps(operations)
    const state = createFallbackState("openai/primary")
    state.currentModel = "openai/current"
    state.pendingFallbackModel = "openai/current"
    state.attemptCount = 1
    deps.sessionStates.set(sessionID, state)
    deps.sessionRetryInFlight.add(sessionID)
    deps.sessionAwaitingFallbackResult.add(sessionID)
    const handler = createMessageUpdateHandler(deps, createRuntimeFallbackHelpers(deps, operations))

    await handler({
      sessionID,
      info: {
        role: "assistant",
        model: "openai/primary",
        error: {
          name: "ContentFilterError",
          data: { message: "Blocked by the provider's content management policy." },
        },
      },
    })

    expect(operations).toEqual([])
    expect(deps.sessionRetryInFlight.has(sessionID)).toBe(true)
    expect(deps.sessionAwaitingFallbackResult.has(sessionID)).toBe(true)
    expect(state.pendingFallbackModel).toBe("openai/current")
    expect(state.attemptCount).toBe(1)
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
})


describe('Internal abort suppression guard (Layer-2)', () => {
  it('#given assistant message with NO error while sessionRetryInFlight is set #when message update is handled #then guard returns early and PRESERVES sessionAwaitingFallbackResult (internal abort suppressed)', async () => {
    // given: omo fallback in flight; assistant message with no visible content (omo own abort)
    const sessionID = 'session-internal-guard'
    const operations: string[] = []
    SessionCategoryRegistry.register(sessionID, 'test')
    const deps = createRuntimeFallbackDeps(operations)
    deps.sessionRetryInFlight.add(sessionID)
    deps.sessionAwaitingFallbackResult.add(sessionID) // fallback result pending
    const handler = createMessageUpdateHandler(deps, createRuntimeFallbackHelpers(deps, operations))

    // when: assistant message update with NO error (the abort omo itself caused)
    await handler({ sessionID, info: { role: 'assistant', model: 'openai/gpt-5.4' } })

    // then: sessionAwaitingFallbackResult is PRESERVED (guard returns early, doesn't clear it)
    // and no abort/dispatch happens — the internal abort is silently suppressed
    expect(deps.sessionAwaitingFallbackResult.has(sessionID)).toBe(true)
    expect(operations).toEqual([])
  })
})


describe('Internal abort suppression guard (Layer-2)', () => {
  it('#given assistant message with NO error while sessionRetryInFlight is set #when message update is handled #then guard returns early PRESERVING sessionStatusRetryKeys (internal abort suppressed, visible-response path skipped)', async () => {
    // given: omo fallback in flight; assistant message with no visible content (omo own abort)
    const sessionID = 'session-internal-guard'
    const operations: string[] = []
    SessionCategoryRegistry.register(sessionID, 'test')
    const deps = createRuntimeFallbackDeps(operations)
    deps.sessionRetryInFlight.add(sessionID)
    deps.sessionAwaitingFallbackResult.add(sessionID)
    deps.sessionStatusRetryKeys.set(sessionID, 'retry-key-1') // marker that visible-path would clear
    const handler = createMessageUpdateHandler(deps, createRuntimeFallbackHelpers(deps, operations))

    // when: assistant message update with NO error (the abort omo itself caused)
    await handler({ sessionID, info: { role: 'assistant', model: 'openai/gpt-5.4' } })

    // then: guard returns early — sessionStatusRetryKeys is PRESERVED (visible-path skipped)
    // sessionAwaitingFallbackResult is also PRESERVED
    expect(deps.sessionStatusRetryKeys.get(sessionID)).toBe('retry-key-1')
    expect(deps.sessionAwaitingFallbackResult.has(sessionID)).toBe(true)
    expect(operations).toEqual([])
  })
})
