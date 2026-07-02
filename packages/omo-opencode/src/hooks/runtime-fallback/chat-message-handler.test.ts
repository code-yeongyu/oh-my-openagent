/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { createChatMessageHandler } from "./chat-message-handler"
import { createFallbackState } from "./fallback-state"
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

function createDeps(configOverrides: Partial<HookDeps["config"]> = {}): HookDeps {
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
      ...configOverrides,
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

describe("createChatMessageHandler runtime fallback model override", () => {
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
    const deps = createDeps({ restore_primary_after_cooldown: true })
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

  test("#given session is on an accepted fallback #when a later user message is transformed after cooldown #then it stays on the fallback model", async () => {
    // given
    const deps = createDeps({ cooldown_seconds: 0 })
    const sessionID = "session-active-fallback"
    const state = createFallbackState("openai/gpt-5.4")
    state.currentModel = "litellm/openai.eu.gpt-5.5"
    state.fallbackIndex = 0
    state.failedModels.set("openai/gpt-5.4", Date.now() - 60_000)
    deps.sessionStates.set(sessionID, state)
    const handler = createChatMessageHandler(deps)
    const output: { message: { model?: { providerID: string; modelID: string } } } = { message: {} }

    // when
    await handler(
      {
        sessionID,
        model: {
          providerID: "litellm",
          modelID: "openai.eu.gpt-5.5",
        },
      },
      output,
    )

    // then
    expect(output.message.model).toEqual({
      providerID: "litellm",
      modelID: "openai.eu.gpt-5.5",
    })
    expect(deps.sessionStates.get(sessionID)?.currentModel).toBe("litellm/openai.eu.gpt-5.5")
  })
})
