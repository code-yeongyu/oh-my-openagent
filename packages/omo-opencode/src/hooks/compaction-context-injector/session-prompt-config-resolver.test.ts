import { afterEach, describe, expect, it } from "bun:test"

import { _resetForTesting } from "../../features/claude-code-session-state"
import { clearSessionModel, setSessionModel } from "../../shared/session-model-state"
import { clearSessionTools } from "../../shared/session-tools-store"
import {
  resolveLatestSessionPromptConfig,
  resolveSessionPromptConfig,
} from "./session-prompt-config-resolver"

type SessionMessage = {
  info?: {
    role?: string
    agent?: string
    model?: {
      providerID?: string
      modelID?: string
    }
    tools?: Record<string, boolean | "allow" | "deny" | "ask">
  }
  parts?: Array<{ type: string; text?: string; synthetic?: boolean }>
}

function createMockContext(messages: SessionMessage[]) {
  return {
    client: {
      session: {
        messages: async () => ({ data: messages }),
      },
    },
    directory: "/tmp/test",
  }
}

describe("session prompt config resolver", () => {
  const sessionID = "ses_compaction_model_validation"

  afterEach(() => {
    _resetForTesting()
    clearSessionModel(sessionID)
    clearSessionTools()
  })

  it("prefers the latest non-compaction model over poisoned session state", async () => {
    // given
    setSessionModel(sessionID, {
      providerID: "anthropic",
      modelID: "claude-opus-4-1",
    })
    const ctx = createMockContext([
      {
        info: {
          agent: "atlas",
          model: { providerID: "openai", modelID: "gpt-5" },
          tools: { bash: "allow" },
        },
      },
      {
        info: {
          agent: "compaction",
          model: { providerID: "anthropic", modelID: "claude-opus-4-1" },
        },
      },
    ])

    // when
    const promptConfig = await resolveSessionPromptConfig(ctx, sessionID)

    // then
    expect(promptConfig).toEqual({
      agent: "atlas",
      model: { providerID: "openai", modelID: "gpt-5" },
      tools: { bash: true },
    })
  })

  it("ignores internal compaction recovery and Boulder continuation messages when resolving the session model", async () => {
    // given
    const ctx = createMockContext([
      {
        info: {
          role: "user",
          agent: "Atlas - Plan Executor",
          model: { providerID: "anthropic", modelID: "claude-opus-4-8" },
          tools: { bash: "allow" },
        },
        parts: [{ type: "text", text: "작업재개" }],
      },
      {
        info: {
          role: "user",
          agent: "Atlas - Plan Executor",
          model: { providerID: "openai", modelID: "gpt-5.5" },
        },
        parts: [{ type: "text", text: "[SYSTEM DIRECTIVE: OH-MY-OPENCODE - BOULDER CONTINUATION] continue work" }],
      },
      {
        info: {
          role: "user",
          agent: "Atlas - Plan Executor",
          model: { providerID: "openai", modelID: "gpt-5.5" },
        },
        parts: [{ type: "text", text: "[restore checkpointed session agent configuration after compaction]\n<!-- OMO_INTERNAL_INITIATOR -->" }],
      },
    ])

    // when
    const promptConfig = await resolveSessionPromptConfig(ctx, sessionID)
    const latestPromptConfig = await resolveLatestSessionPromptConfig(ctx, sessionID)

    // then
    expect(promptConfig).toEqual({
      agent: "Atlas - Plan Executor",
      model: { providerID: "anthropic", modelID: "claude-opus-4-8" },
      tools: { bash: true },
    })
    expect(latestPromptConfig).toEqual({
      agent: "Atlas - Plan Executor",
      model: { providerID: "anthropic", modelID: "claude-opus-4-8" },
      tools: { bash: true },
    })
  })

  it("omits a compaction model from the latest prompt config", async () => {
    // given
    const ctx = createMockContext([
      {
        info: {
          agent: "atlas",
          model: { providerID: "openai", modelID: "gpt-5" },
        },
      },
      {
        info: {
          agent: "compaction",
          model: { providerID: "anthropic", modelID: "claude-opus-4-1" },
        },
      },
    ])

    // when
    const promptConfig = await resolveLatestSessionPromptConfig(ctx, sessionID)

    // then
    expect(promptConfig).toEqual({ agent: "compaction" })
  })
})
