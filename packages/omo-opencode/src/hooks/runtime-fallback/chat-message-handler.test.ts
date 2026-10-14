import { describe, expect, test } from "bun:test"

import { createChatMessageHandler } from "./chat-message-handler"
import { createFallbackState } from "./fallback-state"
import type { HookDeps } from "./types"
import { OMO_INTERNAL_INITIATOR_MARKER } from "../../shared/internal-initiator-marker"
import { OMO_RUNTIME_FALLBACK_RETRY_MARKER } from "../../shared/runtime-fallback-retry-marker"

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
  }
}

describe("createChatMessageHandler runtime fallback model override", () => {
  test("#given retained retry status keys #when the user selects another model #then the reset starts a fresh retry generation", async () => {
    // given
    const deps = createDeps()
    const sessionID = "session-manual-model-reset"
    const state = createFallbackState("openai/gpt-5.4")
    state.currentModel = "google/gemini-2.5-pro"
    deps.sessionStates.set(sessionID, state)
    deps.sessionStatusRetryKeys.set(sessionID, new Set(["openai/gpt-5.4:1:quota exceeded"]))
    const handler = createChatMessageHandler(deps)

    // when
    await handler(
      {
        sessionID,
        model: {
          providerID: "anthropic",
          modelID: "claude-opus-4-7",
        },
      },
      { message: {} },
    )

    // then
    expect(deps.sessionStatusRetryKeys.has(sessionID)).toBe(false)
    expect(deps.sessionStates.get(sessionID)?.currentModel).toBe("anthropic/claude-opus-4-7")
  })

  test("#given retained variant retry keys #when the user changes only the variant #then the reset starts a fresh retry generation", async () => {
    // given
    const deps = createDeps()
    const sessionID = "session-manual-variant-reset"
    const state = createFallbackState({
      providerID: "openai",
      modelID: "gpt-5.4",
      variant: "high",
    })
    deps.sessionStates.set(sessionID, state)
    deps.sessionStatusRetryKeys.set(sessionID, new Set(["openai/gpt-5.4(low):1:quota exceeded"]))
    deps.sessionRetryInFlight.add(sessionID)
    deps.sessionAwaitingFallbackResult.add(sessionID)
    const fallbackTimeout = setTimeout(() => {}, 60_000)
    fallbackTimeout.unref()
    deps.sessionFallbackTimeouts.set(sessionID, fallbackTimeout)
    const handler = createChatMessageHandler(deps)

    // when
    await handler(
      {
        sessionID,
        model: {
          providerID: "openai",
          modelID: "gpt-5.4",
        },
      },
      { message: { variant: "low" } },
    )

    // then
    expect(deps.sessionStatusRetryKeys.has(sessionID)).toBe(false)
    expect(deps.sessionRetryInFlight.has(sessionID)).toBe(false)
    expect(deps.sessionAwaitingFallbackResult.has(sessionID)).toBe(false)
    expect(deps.sessionFallbackTimeouts.has(sessionID)).toBe(false)
    expect(deps.sessionStates.get(sessionID)?.currentModel).toBe("openai/gpt-5.4(low)")
  })

  test("#given session is on an accepted fallback #when a later user message is transformed after cooldown #then it stays on the fallback model", async () => {
    // given
    const deps = createDeps()
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

  test("#given an accepted variant fallback #when the fallback override is reapplied #then model and variant remain separate", async () => {
    // given
    const deps = createDeps()
    const sessionID = "session-active-variant-fallback"
    const state = createFallbackState("anthropic/claude-opus-4-7")
    state.currentModel = "openai/gpt-5.4(high)"
    state.fallbackIndex = 0
    deps.sessionStates.set(sessionID, state)
    const handler = createChatMessageHandler(deps)
    const output: {
      message: {
        model?: { providerID: string; modelID: string }
        variant?: string
      }
    } = { message: { variant: "high" } }

    // when
    await handler(
      {
        sessionID,
        model: {
          providerID: "openai",
          modelID: "gpt-5.4",
        },
      },
      output,
    )

    // then
    expect(output.message).toEqual({
      model: {
        providerID: "openai",
        modelID: "gpt-5.4",
      },
      variant: "high",
    })
  })

  test("#given an explicit-variant fallback and a base primary #when cooldown restoration runs #then the fallback-only variant is removed", async () => {
    // given
    const deps = createDeps()
    deps.config.restore_primary_after_cooldown = true
    const sessionID = "session-clear-fallback-only-variant"
    const state = createFallbackState("openai/gpt-5.4")
    state.currentModel = "anthropic/claude-opus-4-7(high)"
    state.fallbackIndex = 0
    deps.sessionStates.set(sessionID, state)
    const handler = createChatMessageHandler(deps)
    const output: {
      message: {
        model?: { providerID: string; modelID: string }
        variant?: string
      }
    } = { message: { variant: "high" } }

    // when
    await handler(
      {
        sessionID,
        model: {
          providerID: "anthropic",
          modelID: "claude-opus-4-7",
        },
      },
      output,
    )

    // then
    expect(output.message).toEqual({
      model: {
        providerID: "openai",
        modelID: "gpt-5.4",
      },
    })
  })

  test("#given an inherited primary variant #when cooldown restoration runs #then the inherited variant remains applied", async () => {
    // given
    const deps = createDeps()
    deps.config.restore_primary_after_cooldown = true
    deps.pluginConfig = {
      agents: {
        sisyphus: {
          variant: "high",
        },
      },
    }
    const sessionID = "session-restore-inherited-primary-variant"
    const state = createFallbackState("openai/gpt-5.4")
    state.currentModel = "anthropic/claude-opus-4-7(high)"
    state.fallbackIndex = 0
    deps.sessionStates.set(sessionID, state)
    const handler = createChatMessageHandler(deps)
    const output: {
      message: {
        model?: { providerID: string; modelID: string }
        variant?: string
      }
    } = { message: { variant: "high" } }

    // when
    await handler(
      {
        sessionID,
        agent: "sisyphus",
        model: {
          providerID: "anthropic",
          modelID: "claude-opus-4-7",
        },
      },
      output,
    )

    // then
    expect(output.message).toEqual({
      model: {
        providerID: "openai",
        modelID: "gpt-5.4",
      },
      variant: "high",
    })
  })

  test("#given a capped state #when a human prompt arrives #then only the cap counters reset", async () => {
    const deps = createDeps()
    const sessionID = "session-capped-human-prompt"
    const state = createFallbackState("openai/gpt-5.4")
    state.currentModel = "google/gemini-2.5-pro"
    state.fallbackIndex = 1
    state.attemptCount = deps.config.max_fallback_attempts
    state.failedModels.set("openai/gpt-5.4", Date.now())
    deps.sessionStates.set(sessionID, state)
    const handler = createChatMessageHandler(deps)

    await handler({ sessionID, model: { providerID: "google", modelID: "gemini-2.5-pro" } }, {
      message: {},
      parts: [{ type: "text", text: "Please continue with the task" }],
    })

    expect(state.attemptCount).toBe(0)
    expect(state.fallbackIndex).toBe(-1)
    expect(state.failedModels.size).toBe(1)
    expect(state.currentModel).toBe("google/gemini-2.5-pro")
  })

  test("#given a capped state #when an internal initiator prompt arrives #then the cap remains", async () => {
    const deps = createDeps()
    const sessionID = "session-capped-internal-prompt"
    const state = createFallbackState("openai/gpt-5.4")
    state.attemptCount = deps.config.max_fallback_attempts
    state.fallbackIndex = 1
    deps.sessionStates.set(sessionID, state)

    await createChatMessageHandler(deps)({ sessionID }, {
      message: {},
      parts: [{ type: "text", text: `wake${OMO_INTERNAL_INITIATOR_MARKER}` }],
    })

    expect(state.attemptCount).toBe(deps.config.max_fallback_attempts)
    expect(state.fallbackIndex).toBe(1)
  })

  test("#given a capped state #when a runtime fallback retry prompt arrives #then the cap remains", async () => {
    const deps = createDeps()
    const sessionID = "session-capped-retry-prompt"
    const state = createFallbackState("openai/gpt-5.4")
    state.attemptCount = deps.config.max_fallback_attempts
    state.fallbackIndex = 1
    deps.sessionStates.set(sessionID, state)

    await createChatMessageHandler(deps)({ sessionID }, {
      message: {},
      parts: [{ type: "text", text: `retry this${OMO_RUNTIME_FALLBACK_RETRY_MARKER}` }],
    })

    expect(state.attemptCount).toBe(deps.config.max_fallback_attempts)
    expect(state.fallbackIndex).toBe(1)
  })

  test("#given a capped state #when chat.message has no parts #then the cap remains", async () => {
    const deps = createDeps()
    const sessionID = "session-capped-no-parts"
    const state = createFallbackState("openai/gpt-5.4")
    state.attemptCount = deps.config.max_fallback_attempts
    state.fallbackIndex = 1
    deps.sessionStates.set(sessionID, state)

    await createChatMessageHandler(deps)({ sessionID }, { message: {} })

    expect(state.attemptCount).toBe(deps.config.max_fallback_attempts)
    expect(state.fallbackIndex).toBe(1)
  })

  test("#given a capped state #when the rerouted compaction auto-continue prompt arrives #then the cap remains", async () => {
    const deps = createDeps()
    const sessionID = "session-capped-compaction-continue"
    const state = createFallbackState("openai/gpt-5.4")
    state.currentModel = "google/gemini-2.5-pro"
    state.attemptCount = deps.config.max_fallback_attempts
    state.fallbackIndex = 1
    deps.sessionStates.set(sessionID, state)
    const COMPACTION_CONTINUE_TEXT =
      "Continue if you have next steps, or stop and ask for clarification if you are unsure how to proceed."
    const reissuedParts: Array<{ type: string; text?: string; metadata?: { compaction_continue: boolean } }> = [
      { type: "text", text: COMPACTION_CONTINUE_TEXT, metadata: { compaction_continue: true } },
    ]

    await createChatMessageHandler(deps)(
      { sessionID, model: { providerID: "google", modelID: "gemini-2.5-pro" } },
      { message: {}, parts: reissuedParts ?? [] },
    )

    expect(state.attemptCount).toBe(deps.config.max_fallback_attempts)
    expect(state.fallbackIndex).toBe(1)
  })

  test("#given a capped state #when a marker-less synthetic prompt arrives #then the cap remains", async () => {
    const deps = createDeps()
    const sessionID = "session-capped-synthetic-prompt"
    const state = createFallbackState("openai/gpt-5.4")
    state.attemptCount = deps.config.max_fallback_attempts
    state.fallbackIndex = 1
    deps.sessionStates.set(sessionID, state)
    const syntheticParts = [{ type: "text", text: "Continue if you have next steps", synthetic: true }]

    await createChatMessageHandler(deps)({ sessionID }, { message: {}, parts: syntheticParts })

    expect(state.attemptCount).toBe(deps.config.max_fallback_attempts)
    expect(state.fallbackIndex).toBe(1)
  })

  test("#given a capped state #when a human prompt carries a synthetic attachment part #then the cap counters reset", async () => {
    const deps = createDeps()
    const sessionID = "session-capped-human-prompt-with-synthetic-part"
    const state = createFallbackState("openai/gpt-5.4")
    state.attemptCount = deps.config.max_fallback_attempts
    state.fallbackIndex = 1
    deps.sessionStates.set(sessionID, state)
    const humanPartsWithAttachment = [
      { type: "text", text: "Please review this file" },
      { type: "text", text: "Called the Read tool with the following input: {}", synthetic: true },
    ]

    await createChatMessageHandler(deps)({ sessionID }, { message: {}, parts: humanPartsWithAttachment })

    expect(state.attemptCount).toBe(0)
    expect(state.fallbackIndex).toBe(-1)
  })
})
