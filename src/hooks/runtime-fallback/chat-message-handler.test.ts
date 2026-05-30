import { describe, expect, test } from "bun:test"

import type { HookDeps, RuntimeFallbackPluginInput } from "./types"
import { createChatMessageHandler } from "./chat-message-handler"
import { createFallbackState } from "./fallback-state"

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
  test("#given a reopened fallback session #when the next user message is prepared #then it restores the preferred primary model", async () => {
    const deps = createDeps()
    const sessionID = "session-reopen-restore"
    const state = createFallbackState("openai/gpt-5.5")
    state.currentModel = "opencode-go/deepseek-v4-pro"
    state.fallbackIndex = 0
    state.restorePrimaryOnNextMessage = true
    deps.sessionStates.set(sessionID, state)

    const handler = createChatMessageHandler(deps)
    const output: { message: { model?: { providerID: string; modelID: string } } } = { message: {} }

    await handler({
      sessionID,
      model: { providerID: "opencode-go", modelID: "deepseek-v4-pro" },
    }, output)

    expect(output.message.model).toEqual({ providerID: "openai", modelID: "gpt-5.5" })
    const restored = deps.sessionStates.get(sessionID)
    expect(restored?.currentModel).toBe("openai/gpt-5.5")
    expect(restored?.restorePrimaryOnNextMessage).toBeUndefined()
  })

  test("#given a cooled-down fallback session #when the user sends another message #then it retries the original model", async () => {
    const deps = createDeps()
    const sessionID = "session-cooldown-restore"
    const state = createFallbackState("openai/gpt-5.5")
    state.currentModel = "opencode-go/deepseek-v4-pro"
    state.fallbackIndex = 0
    state.failedModels.set("openai/gpt-5.5", Date.now() - 61_000)
    deps.sessionStates.set(sessionID, state)

    const handler = createChatMessageHandler(deps)
    const output: { message: { model?: { providerID: string; modelID: string } } } = { message: {} }

    await handler({
      sessionID,
      model: { providerID: "opencode-go", modelID: "deepseek-v4-pro" },
    }, output)

    expect(output.message.model).toEqual({ providerID: "openai", modelID: "gpt-5.5" })
    const restored = deps.sessionStates.get(sessionID)
    expect(restored?.currentModel).toBe("openai/gpt-5.5")
    expect(restored?.attemptCount).toBe(0)
  })
})
