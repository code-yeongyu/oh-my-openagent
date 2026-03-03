import { describe, expect, it } from "bun:test"
import { createAnthropicServerCompactionHook } from "./hook"

function createMockInput(overrides: Partial<{
  sessionID: string
  agentName: string
  providerID: string
  modelID: string
  providerId: string
  variant: string
}> = {}) {
  return {
    sessionID: overrides.sessionID ?? "test-session",
    agent: { name: overrides.agentName ?? "sisyphus" },
    model: {
      providerID: overrides.providerID ?? "anthropic",
      modelID: overrides.modelID ?? "claude-opus-4-6",
    },
    provider: { id: overrides.providerId ?? "anthropic" },
    message: { variant: overrides.variant },
  }
}

function createMockOutput(options: Record<string, unknown> = {}) {
  return {
    temperature: 0.7,
    topP: undefined,
    topK: undefined,
    options: { ...options },
  }
}

describe("anthropic-server-compaction", () => {
  describe("#given default config", () => {
    const hook = createAnthropicServerCompactionHook()

    describe("#when model is claude-opus-4-6 on anthropic provider", () => {
      it("#then injects contextManagement with default trigger", async () => {
        const input = createMockInput({ providerID: "anthropic", modelID: "claude-opus-4-6" })
        const output = createMockOutput()
        await hook["chat.params"](input, output)

        expect(output.options.contextManagement).toEqual({
          edits: [{
            type: "compact_20260112",
            trigger: { type: "input_tokens", value: 128_000 },
            pauseAfterCompaction: false,
          }],
        })
      })
    })

    describe("#when model is claude-sonnet-4-6 on anthropic provider", () => {
      it("#then injects contextManagement", async () => {
        const input = createMockInput({ providerID: "anthropic", modelID: "claude-sonnet-4-6" })
        const output = createMockOutput()
        await hook["chat.params"](input, output)

        expect(output.options.contextManagement).toBeDefined()
      })
    })

    describe("#when model is claude-opus-4.6 (dot variant)", () => {
      it("#then injects contextManagement", async () => {
        const input = createMockInput({ providerID: "anthropic", modelID: "claude-opus-4.6" })
        const output = createMockOutput()
        await hook["chat.params"](input, output)

        expect(output.options.contextManagement).toBeDefined()
      })
    })

    describe("#when provider is google-vertex-anthropic", () => {
      it("#then injects contextManagement", async () => {
        const input = createMockInput({ providerID: "google-vertex-anthropic", modelID: "claude-opus-4-6" })
        const output = createMockOutput()
        await hook["chat.params"](input, output)

        expect(output.options.contextManagement).toBeDefined()
      })
    })

    describe("#when provider is opencode", () => {
      it("#then injects contextManagement for claude-sonnet-4.6", async () => {
        const input = createMockInput({ providerID: "opencode", modelID: "claude-sonnet-4.6" })
        const output = createMockOutput()
        await hook["chat.params"](input, output)

        expect(output.options.contextManagement).toBeDefined()
      })
    })

    describe("#when provider is github-copilot with claude model", () => {
      it("#then injects contextManagement", async () => {
        const input = createMockInput({ providerID: "github-copilot", modelID: "claude-sonnet-4-6" })
        const output = createMockOutput()
        await hook["chat.params"](input, output)

        expect(output.options.contextManagement).toBeDefined()
      })
    })

    describe("#when model is not Claude 4.6", () => {
      it("#then does not inject for claude-sonnet-4-5", async () => {
        const input = createMockInput({ modelID: "claude-sonnet-4-5" })
        const output = createMockOutput()
        await hook["chat.params"](input, output)

        expect(output.options.contextManagement).toBeUndefined()
      })
 
      it("#then does not inject for gpt-5.2", async () => {
        const input = createMockInput({ providerID: "openai", modelID: "gpt-5.2" })
        const output = createMockOutput()
        await hook["chat.params"](input, output)

        expect(output.options.contextManagement).toBeUndefined()
      })
    })

    describe("#when provider is non-anthropic with non-claude model", () => {
      it("#then does not inject", async () => {
        const input = createMockInput({ providerID: "openai", modelID: "gpt-5.2" })
        const output = createMockOutput()
        await hook["chat.params"](input, output)

        expect(output.options.contextManagement).toBeUndefined()
      })
    })

    describe("#when contextManagement is already set", () => {
      it("#then does not overwrite", async () => {
        const input = createMockInput()
        const existing = { edits: [{ type: "custom" }] }
        const output = createMockOutput({ contextManagement: existing })
        await hook["chat.params"](input, output)

        expect(output.options.contextManagement).toEqual(existing)
      })
    })

    describe("#when modelID is undefined", () => {
      it("#then does not inject", async () => {
        const input = createMockInput({ modelID: "" })
        const output = createMockOutput()
        await hook["chat.params"](input, output)

        expect(output.options.contextManagement).toBeUndefined()
      })
    })

    describe("#when preserving existing options", () => {
      it("#then keeps effort and other options intact", async () => {
        const input = createMockInput()
        const output = createMockOutput({ effort: "max", thinking: { type: "enabled" } })
        await hook["chat.params"](input, output)

        expect(output.options.effort).toBe("max")
        expect(output.options.thinking).toEqual({ type: "enabled" })
        expect(output.options.contextManagement).toBeDefined()
      })
    })
  })

  describe("#given custom config", () => {
    describe("#when triggerTokens is configured", () => {
      it("#then uses configured value", async () => {
        const hook = createAnthropicServerCompactionHook({ triggerTokens: 50_000 })
        const input = createMockInput()
        const output = createMockOutput()
        await hook["chat.params"](input, output)

        const cm = output.options.contextManagement as { edits: Array<{ trigger: { value: number } }> }
        expect(cm.edits[0].trigger.value).toBe(50_000)
      })
    })

    describe("#when instructions are configured", () => {
      it("#then includes instructions in edit", async () => {
        const hook = createAnthropicServerCompactionHook({
          instructions: "Preserve code snippets and variable names.",
        })
        const input = createMockInput()
        const output = createMockOutput()
        await hook["chat.params"](input, output)

        const cm = output.options.contextManagement as { edits: Array<{ instructions?: string }> }
        expect(cm.edits[0].instructions).toBe("Preserve code snippets and variable names.")
      })
    })

    describe("#when instructions are not configured", () => {
      it("#then does not include instructions key", async () => {
        const hook = createAnthropicServerCompactionHook()
        const input = createMockInput()
        const output = createMockOutput()
        await hook["chat.params"](input, output)

        const cm = output.options.contextManagement as { edits: Array<Record<string, unknown>> }
        expect("instructions" in cm.edits[0]).toBe(false)
      })
    })
  })
})
