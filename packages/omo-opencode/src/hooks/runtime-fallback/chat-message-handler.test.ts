/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { createChatMessageHandler } from "./chat-message-handler"
import type { HookDeps, RuntimeFallbackPluginInput, FallbackState } from "./types"

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
    pluginConfig: undefined,
    sessionStates: new Map(),
    sessionLastAccess: new Map(),
    sessionRetryInFlight: new Set(),
    sessionAwaitingFallbackResult: new Set(),
    sessionFallbackTimeouts: new Map(),
    sessionStatusRetryKeys: new Map(),
    internallyAbortedSessions: new Set(),
  }
}

describe("createChatMessageHandler", () => {
  test("#given state with fallback model bearing a variant #when handler runs with no input model #then output modelID has no variant suffix", async () => {
    // given
    const sessionID = "fallback-override"
    const deps = createDeps()
    const state: FallbackState = {
      originalModel: "openai/gpt-5.5(high)",
      currentModel: "openai/gpt-5.5(medium)",
      fallbackIndex: 0,
      failedModels: new Map([["openai/gpt-5.5(high)", Date.now()]]),
      attemptCount: 1,
    }
    deps.sessionStates.set(sessionID, state)
    const handler = createChatMessageHandler(deps)
    const output: { message: { model?: { providerID: string; modelID: string } } } = {
      message: {},
    }

    // when
    await handler({ sessionID }, output)

    // then
    expect(output.message.model).toEqual({
      providerID: "openai",
      modelID: "gpt-5.5",
    })
  })

  test("#given state on a fallback model and original model cooldown expired #when handler runs #then primary model is restored with variant stripped", async () => {
    // given
    const sessionID = "primary-restore"
    const deps = createDeps()
    const state: FallbackState = {
      originalModel: "openai/gpt-5.5(high)",
      currentModel: "github-copilot/gpt-5.3-codex",
      fallbackIndex: 0,
      failedModels: new Map(),
      attemptCount: 1,
    }
    deps.sessionStates.set(sessionID, state)
    const handler = createChatMessageHandler(deps)
    const output: { message: { model?: { providerID: string; modelID: string } } } = {
      message: {},
    }

    // when
    await handler({ sessionID }, output)

    // then
    expect(output.message.model).toEqual({
      providerID: "openai",
      modelID: "gpt-5.5",
    })
  })
})
