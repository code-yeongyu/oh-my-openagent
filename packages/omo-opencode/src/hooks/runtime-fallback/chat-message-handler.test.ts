import { describe, expect, test } from "bun:test"

import { createChatMessageHandler } from "./chat-message-handler"
import { createFallbackState } from "./fallback-state"
import type { HookDeps } from "./types"

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

  test("#given our own marker-carrying fallback retry dispatch after a state wipe #when chat.message fires with the prepared fallback model #then the state is not reset as a manual model change (issue #6751)", async () => {
    // given - a mid-cycle wipe cleared pendingFallbackModel; OMO's own retry
    // dispatch (marked parts, model = prepared fallback) must not be misread
    // as a manual model change, which would corrupt originalModel and enable
    // a backward hop to the just-failed primary.
    const deps = createDeps()
    const sessionID = "session-6751-marker-dispatch"
    const state = createFallbackState("zai/primary")
    state.currentModel = "go/fallback-a"
    state.fallbackIndex = 1
    state.attemptCount = 1
    state.failedModels.set("zai/primary", Date.now())
    deps.sessionStates.set(sessionID, state)
    const handler = createChatMessageHandler(deps)
    const output: {
      message: { model?: { providerID: string; modelID: string } }
      parts?: Array<{ type: string; text?: string }>
    } = {
      message: {},
      parts: [
        { type: "text", text: "continue\n<!-- OMO_RUNTIME_FALLBACK_RETRY -->" },
      ],
    }

    // when - requestedModel (go/fallback-a) matches currentModel here only by
    // coincidence of the wipe shape; the marker alone must suppress resets.
    await handler(
      {
        sessionID,
        model: {
          providerID: "go",
          modelID: "fallback-a",
        },
      },
      output,
    )

    // then
    expect(deps.sessionStates.get(sessionID)).toBe(state)
    expect(state.originalModel).toBe("zai/primary")
    expect(state.currentModel).toBe("go/fallback-a")
    expect(state.fallbackIndex).toBe(1)
    expect(state.attemptCount).toBe(1)
    expect(state.failedModels.get("zai/primary")).toBeDefined()
  })

  test("#given our own marker-carrying dispatch whose model mismatches the wiped currentModel #when chat.message fires #then position bookkeeping survives untouched (issue #6751)", async () => {
    // given - worst-case interleaving from the issue log: the retry dispatch
    // lands against a state whose currentModel is still the primary and whose
    // pendingFallbackModel was lost. The manual-change branch must not fire.
    const deps = createDeps()
    const sessionID = "session-6751-marker-mismatch"
    const state = createFallbackState("zai/primary")
    state.currentModel = "zai/primary"
    state.fallbackIndex = 1
    state.attemptCount = 1
    state.pendingFallbackModel = undefined
    state.failedModels.set("zai/primary", Date.now())
    deps.sessionStates.set(sessionID, state)
    const handler = createChatMessageHandler(deps)
    const output: {
      message: { model?: { providerID: string; modelID: string } }
      parts?: Array<{ type: string; text?: string }>
    } = {
      message: {},
      parts: [
        { type: "text", text: "retry payload\n<!-- OMO_RUNTIME_FALLBACK_RETRY -->" },
      ],
    }

    // when
    await handler(
      {
        sessionID,
        model: {
          providerID: "go",
          modelID: "fallback-a",
        },
      },
      output,
    )

    // then - same object, same position fields, originalModel not corrupted
    expect(deps.sessionStates.get(sessionID)).toBe(state)
    expect(state.originalModel).toBe("zai/primary")
    expect(state.fallbackIndex).toBe(1)
    expect(state.attemptCount).toBe(1)
    expect(state.failedModels.get("zai/primary")).toBeDefined()
  })

  test("#given a marker-carrying dispatch matching pendingFallbackModel #when chat.message fires #then pending is consumed and no reset happens", async () => {
    // given - happy path that must keep working: the dispatcher set
    // pendingFallbackModel before sending; chat.message consumes it quietly.
    const deps = createDeps()
    const sessionID = "session-6751-marker-consume"
    const state = createFallbackState("zai/primary")
    state.currentModel = "go/fallback-a"
    state.fallbackIndex = 1
    state.pendingFallbackModel = "go/fallback-a"
    deps.sessionStates.set(sessionID, state)
    deps.sessionStatusRetryKeys.set(sessionID, new Set(["unknown:1:rate limit"]))
    const handler = createChatMessageHandler(deps)
    const output: {
      message: { model?: { providerID: string; modelID: string } }
      parts?: Array<{ type: string; text?: string }>
    } = {
      message: {},
      parts: [
        { type: "text", text: "continue\n<!-- OMO_RUNTIME_FALLBACK_RETRY -->" },
      ],
    }

    // when
    await handler(
      {
        sessionID,
        model: {
          providerID: "go",
          modelID: "fallback-a",
        },
      },
      output,
    )

    // then
    expect(deps.sessionStates.get(sessionID)).toBe(state)
    expect(state.pendingFallbackModel).toBe(undefined)
    expect(state.originalModel).toBe("zai/primary")
    expect(deps.sessionStatusRetryKeys.has(sessionID)).toBe(false)
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
})
