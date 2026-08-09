import { afterEach, describe, expect, test } from "bun:test"

import { createChatMessageHandler } from "./chat-message-handler"
import { createFallbackState } from "./fallback-state"
import type { HookDeps } from "./types"
import {
  clearAllSessionPromptParams,
  getSessionPromptParams,
  setSessionPromptParams,
} from "../../shared/session-prompt-params-state"

function createDeps(): HookDeps {
  return {
    ctx: {
      client: {
        session: {},
        tui: {},
      },
      directory: "/test/dir",
    },
    config: {
      enabled: true,
      retry_on_errors: [429, 503, 529],
      max_fallback_attempts: 3,
      cooldown_seconds: 0,
      timeout_seconds: 30,
      notify_on_fallback: true,
      restore_primary_after_cooldown: false,
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
    sessionPromptParamsBeforeFallback: new Map(),
  }
}

describe("createChatMessageHandler runtime fallback model override", () => {
  afterEach(() => clearAllSessionPromptParams())

  test("#given session is on an accepted fallback #when a later user message is transformed after cooldown #then it stays on the fallback model", async () => {
    // given
    const deps = createDeps()
    const sessionID = "session-active-fallback"
    const state = createFallbackState("openai/gpt-5.4")
    state.currentModel = "litellm/openai.eu.gpt-5.5"
    state.fallbackIndex = 0
    state.failedModels.set("openai/gpt-5.4", Date.now() - 60_000)
    deps.sessionStates.set(sessionID, state)
    deps.sessionPromptParamsBeforeFallback?.set(sessionID, { temperature: 0.1 })
    setSessionPromptParams(sessionID, { temperature: 0.3, maxOutputTokens: 2048 })
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
    expect(getSessionPromptParams(sessionID)).toEqual({ temperature: 0.3, maxOutputTokens: 2048 })
    expect(deps.sessionPromptParamsBeforeFallback?.has(sessionID)).toBe(true)
  })

  test("restores prompt settings when the user manually changes models", async () => {
    // given
    const deps = createDeps()
    const sessionID = "session-manual-model-change"
    const original = { temperature: 0.1 }
    deps.sessionPromptParamsBeforeFallback?.set(sessionID, original)
    setSessionPromptParams(sessionID, { temperature: 0.3 })
    const state = createFallbackState("openai/gpt-5.4")
    state.currentModel = "custom/fallback"
    deps.sessionStates.set(sessionID, state)
    const handler = createChatMessageHandler(deps)

    // when
    await handler(
      { sessionID, model: { providerID: "google", modelID: "gemini" } },
      { message: {} },
    )

    // then
    expect(getSessionPromptParams(sessionID)).toEqual(original)
    expect(deps.sessionPromptParamsBeforeFallback?.size).toBe(0)
  })
})
