import { afterEach, describe, expect, it } from "bun:test"
import type { Plugin } from "@opencode/plugin"
import type { SessionContext } from "@opencode/plugin/promise/session"
import { applyContextParamsV2, registerSessionV2Hooks } from "./v2-session"
import {
  clearSessionPromptParams,
  setSessionPromptParams,
} from "./shared/session-prompt-params-state"

const SESSION_ID = "ses-v2-context-test"

function buildEvent(): SessionContext {
  return {
    sessionID: SESSION_ID,
    model: { providerID: "acme-unknown", id: "nope-unknown" },
    system: [],
    messages: [],
    options: {},
  }
}

describe("v2 session context params", () => {
  afterEach(() => {
    // given isolation between cases
    clearSessionPromptParams(SESSION_ID)
  })

  it("applies stored prompt params to request options", () => {
    // given stored per-session params
    setSessionPromptParams(SESSION_ID, { temperature: 0.2, maxOutputTokens: 8000 })
    const event = buildEvent()

    // when the context hook runs
    applyContextParamsV2(event)

    // then options carry the stored values under v2 semantic names
    expect(event.options.temperature).toBe(0.2)
    expect(event.options.maxTokens).toBe(8000)
  })

  it("leaves options empty when no stored params exist", () => {
    // given no stored params
    const event = buildEvent()

    // when the context hook runs
    applyContextParamsV2(event)

    // then stored-value keys stay absent
    expect("temperature" in event.options).toBe(false)
    expect("maxTokens" in event.options).toBe(false)
  })

  it("registers a context hook that applies stored params on invocation", async () => {
    // given a fake v2 context capturing the registered callback
    let captured: ((event: SessionContext) => void) | undefined
    const ctx = {
      session: {
        hook: async (_name: string, callback: (event: SessionContext) => void) => {
          captured = callback
        },
      },
    }
    setSessionPromptParams(SESSION_ID, { temperature: 0.2, maxOutputTokens: 8000 })
    const event = buildEvent()

    // when setup registers hooks and the server invokes the callback
    await registerSessionV2Hooks(ctx as unknown as Plugin.Context)
    captured?.(event)

    // then the invocation applied stored values
    expect(captured).not.toBeUndefined()
    expect(event.options.temperature).toBe(0.2)
    expect(event.options.maxTokens).toBe(8000)
  })

  it("records the agent identity for agent-gated guards", async () => {
    // given a fake v2 context capturing the registered callback
    let captured: ((event: SessionContext & { agent: string }) => void) | undefined
    const ctx = {
      session: {
        hook: async (
          _name: string,
          callback: (event: SessionContext & { agent: string }) => void,
        ) => {
          captured = callback
        },
      },
    }
    const { getSessionAgent, clearSessionAgent } = await import(
      "./features/claude-code-session-state"
    )

    try {
      // when the server invokes the callback with an agent
      await registerSessionV2Hooks(ctx as unknown as Plugin.Context)
      captured?.({
        sessionID: SESSION_ID,
        agent: "atlas",
        model: { providerID: "acme-unknown", id: "nope-unknown" },
        system: [],
        messages: [],
        options: {},
      } as unknown as SessionContext & { agent: string })

      // then the agent is recorded session-locally
      expect(getSessionAgent(SESSION_ID)).toBe("atlas")
    } finally {
      clearSessionAgent(SESSION_ID)
    }
  })
})
