import { afterEach, describe, expect, it, test } from "bun:test"

import { _resetForTesting } from "../../features/claude-code-session-state"
import { clearActiveCompactionPin, setActiveCompactionPin } from "../../shared/compaction-pin-state"
import { clearSessionModel, setSessionModel } from "../../shared/session-model-state"
import { clearSessionTools } from "../../shared/session-tools-store"
import {
  resolveLatestSessionPromptConfig,
  resolveSessionPromptConfig,
} from "./session-prompt-config-resolver"

// fix: compaction-pin-checkpoint — the backward scan must not accept a model
// from compaction marker/summary rows; they carry the summarizer pin, not the
// working model, and re-injecting them hijacks the session after compaction.

const fakeCtx = (messages: Array<Record<string, unknown>>) => ({
  client: {
    session: {
      messages: async () => ({ data: messages }),
    },
  },
  directory: "test",
})

describe("resolveSessionPromptConfig (compaction-pin-checkpoint)", () => {
  test("skips the compaction marker's pin model and keeps the last working model", async () => {
    const ctx = fakeCtx([
      { info: { agent: "sisyphus", model: { providerID: "kimi-for-coding", modelID: "k3-256k" } } },
      { info: { agent: "compaction", model: { providerID: "zai-coding-plan", modelID: "glm-5.3-flash" } } },
    ])
    const config = await resolveSessionPromptConfig(ctx as never, "ses_test")
    expect(config.model).toEqual({ providerID: "kimi-for-coding", modelID: "k3-256k" })
  })

  test("compaction-pin-checkpoint: marker tagged with the working agent carrying the pin model is skipped", async () => {
    setActiveCompactionPin("ses_pin", { providerID: "zai-coding-plan", modelID: "glm-5.3-flash" })
    try {
      const ctx = fakeCtx([
        { info: { agent: "Sisyphus - ultraworker", model: { providerID: "kimi-for-coding", modelID: "k3-256k" } } },
        { info: { agent: "Sisyphus - ultraworker", model: { providerID: "zai-coding-plan", modelID: "glm-5.3-flash" } } },
      ])
      const config = await resolveSessionPromptConfig(ctx as never, "ses_pin")
      expect(config.model).toEqual({ providerID: "kimi-for-coding", modelID: "k3-256k" })
    } finally {
      clearActiveCompactionPin("ses_pin")
    }
  })

  test("compaction-pin-checkpoint: model resolution falls through when only pin-carrying rows exist", async () => {
    setActiveCompactionPin("ses_pin2", { providerID: "zai-coding-plan", modelID: "glm-5.3-flash" })
    try {
      const ctx = fakeCtx([
        { info: { agent: "Sisyphus - ultraworker", model: { providerID: "zai-coding-plan", modelID: "glm-5.3-flash" } } },
      ])
      const config = await resolveSessionPromptConfig(ctx as never, "ses_pin2")
      expect(config.model).toBeUndefined()
    } finally {
      clearActiveCompactionPin("ses_pin2")
    }
  })

  test("compaction-pin-checkpoint: a core summary row on the configured compaction agent never becomes the working model", async () => {
    // OMO pins the preemptive summarize to glm-5.3-flash, but the core's configured
    // compaction agent (opencode-core-fix compaction-model-override) summarizes on
    // openai/gpt-6-luna:low and tags the summary row agent=compaction with flat fields.
    setActiveCompactionPin("ses_pin3", { providerID: "zai-coding-plan", modelID: "glm-5.3-flash" })
    try {
      const ctx = fakeCtx([
        { info: { agent: "Sisyphus - ultraworker", providerID: "kimi-for-coding", modelID: "k3-256k", variant: "high" } },
        { info: { agent: "Sisyphus - ultraworker", model: { providerID: "zai-coding-plan", modelID: "glm-5.3-flash" } } },
        { info: { agent: "compaction", providerID: "openai", modelID: "gpt-6-luna", variant: "low" } },
      ])
      const config = await resolveSessionPromptConfig(ctx as never, "ses_pin3")
      expect(config.model).toEqual({ providerID: "kimi-for-coding", modelID: "k3-256k", variant: "high" })
      expect(config.agent).toBe("Sisyphus - ultraworker")
    } finally {
      clearActiveCompactionPin("ses_pin3")
    }
  })

  test("still resolves the model when no compaction rows exist", async () => {
    const ctx = fakeCtx([
      { info: { agent: "sisyphus", model: { providerID: "kimi-for-coding", modelID: "k3-256k" } } },
    ])
    const config = await resolveSessionPromptConfig(ctx as never, "ses_test")
    expect(config.model).toEqual({ providerID: "kimi-for-coding", modelID: "k3-256k" })
  })

  test("falls back to stored model only when no non-compaction message carries one", async () => {
    const ctx = fakeCtx([
      { info: { agent: "compaction", model: { providerID: "zai-coding-plan", modelID: "glm-5.3-flash" } } },
    ])
    const config = await resolveSessionPromptConfig(ctx as never, "ses_test")
    expect(config.model).toBeUndefined()
  })
})

type SessionMessage = {
  info?: {
    agent?: string
    model?: {
      providerID?: string
      modelID?: string
      variant?: string
    }
    providerID?: string
    modelID?: string
    variant?: string
    tools?: Record<string, boolean | "allow" | "deny" | "ask">
  }
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

  it("captures a flat model variant into the checkpoint model", async () => {
    // given: OpenCode assistant messages carry providerID/modelID/variant flat, not nested
    const ctx = createMockContext([
      {
        info: {
          agent: "sisyphus",
          providerID: "openai",
          modelID: "gpt-5",
          variant: "max",
          tools: { bash: true },
        },
      },
    ])

    // when
    const promptConfig = await resolveSessionPromptConfig(ctx, sessionID)

    // then
    expect(promptConfig).toEqual({
      agent: "sisyphus",
      model: { providerID: "openai", modelID: "gpt-5", variant: "max" },
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
