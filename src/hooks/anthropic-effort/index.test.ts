import { describe, expect, it } from "bun:test"
import { createAnthropicEffortHook } from "./index"

interface ChatParamsInput {
  sessionID: string
  agent: { name?: string }
  model: { providerID: string; modelID: string; id?: string; api?: { npm?: string } }
  provider: { id: string }
  message: { variant?: string }
}

interface ChatParamsOutput {
  temperature?: number
  topP?: number
  topK?: number
  options: Record<string, unknown>
}

function createMockParams(overrides: {
  providerID?: string
  modelID?: string
  variant?: string
  agentName?: string
  existingOptions?: Record<string, unknown>
}): { input: ChatParamsInput; output: ChatParamsOutput } {
  const providerID = overrides.providerID ?? "anthropic"
  const modelID = overrides.modelID ?? "claude-opus-4-6"
  const variant = "variant" in overrides ? overrides.variant : "max"
  const agentName = overrides.agentName ?? "sisyphus"
  const existingOptions = overrides.existingOptions ?? {}

  return {
    input: {
      sessionID: "test-session",
      agent: { name: agentName },
      model: { providerID, modelID },
      provider: { id: providerID },
      message: { variant },
    },
    output: {
      temperature: 0.1,
      options: { ...existingOptions },
    },
  }
}

describe("createAnthropicEffortHook", () => {
  describe("opus family with variant max", () => {
    it("injects effort max for anthropic opus-4-6", async () => {
      const hook = createAnthropicEffortHook()
      const { input, output } = createMockParams({})

      await hook["chat.params"](input, output)

      expect(output.options.effort).toBe("max")
    })

    it("injects effort max for another opus family model such as opus-4-5", async () => {
      const hook = createAnthropicEffortHook()
      const { input, output } = createMockParams({ modelID: "claude-opus-4-5" })

      await hook["chat.params"](input, output)

      expect(output.options.effort).toBe("max")
    })

    it("injects effort max for dotted opus ids", async () => {
      const hook = createAnthropicEffortHook()
      const { input, output } = createMockParams({ modelID: "claude-opus-4.6" })

      await hook["chat.params"](input, output)

      expect(output.options.effort).toBe("max")
    })

    it("should preserve max for other opus model IDs such as opus-4-5", async () => {
      //#given another opus model id that is not 4.6
      const hook = createAnthropicEffortHook()
      const { input, output } = createMockParams({
        modelID: "claude-opus-4-5",
      })

      //#when chat.params hook is called
      await hook["chat.params"](input, output)

      //#then max should still be treated as valid for opus family
      expect(output.options.effort).toBe("max")
      expect(input.message.variant).toBe("max")
    })
  })

  describe("skip conditions", () => {
    it("does nothing when variant is not max", async () => {
      const hook = createAnthropicEffortHook()
      const { input, output } = createMockParams({ variant: "high" })

      await hook["chat.params"](input, output)

      expect(output.options.effort).toBeUndefined()
    })

    it("does nothing when variant is undefined", async () => {
      const hook = createAnthropicEffortHook()
      const { input, output } = createMockParams({ variant: undefined })

      await hook["chat.params"](input, output)

      expect(output.options.effort).toBeUndefined()
    })

    it("should clamp effort to high for non-opus claude model with variant max", async () => {
      //#given claude-sonnet-4-6 (not opus) with variant max
      const hook = createAnthropicEffortHook()
      const { input, output } = createMockParams({ modelID: "claude-sonnet-4-6" })

      await hook["chat.params"](input, output)

      //#then effort should be clamped to high (not max)
      expect(output.options.effort).toBe("high")
      expect(input.message.variant).toBe("high")
    })

    it("does nothing for non-claude providers/models", async () => {
      const hook = createAnthropicEffortHook()
      const { input, output } = createMockParams({ providerID: "openai", modelID: "gpt-5.4" })

      await hook["chat.params"](input, output)

      expect(output.options.effort).toBeUndefined()
    })
  })

  describe("provider guard", () => {
    it("skips effort for google-vertex-anthropic provider", async () => {
      //#given opus on vertex with variant max
      const hook = createAnthropicEffortHook()
      const { input, output } = createMockParams({
        providerID: "google-vertex-anthropic",
        modelID: "claude-opus-4-6",
      })

      //#when chat.params hook is called
      await hook["chat.params"](input, output)

      //#then effort should not be injected (vertex rejects the beta header)
      expect(output.options.effort).toBeUndefined()
      //#and variant should remain unchanged (provider guard returned before clamping)
      expect(input.message.variant).toBe("max")
    })

    it("skips effort for non-opus model on google-vertex-anthropic", async () => {
      //#given sonnet on vertex with variant max
      const hook = createAnthropicEffortHook()
      const { input, output } = createMockParams({
        providerID: "google-vertex-anthropic",
        modelID: "claude-sonnet-4-6",
      })

      //#when chat.params hook is called
      await hook["chat.params"](input, output)

      //#then effort should not be injected (provider guard fires before model check)
      expect(output.options.effort).toBeUndefined()
      //#and variant should remain unchanged (provider guard returned before clamping)
      expect(input.message.variant).toBe("max")
    })

    it("still injects effort for direct anthropic provider with opus", async () => {
      //#given opus on direct anthropic with variant max
      const hook = createAnthropicEffortHook()
      const { input, output } = createMockParams({
        providerID: "anthropic",
        modelID: "claude-opus-4-6",
      })

      //#when chat.params hook is called
      await hook["chat.params"](input, output)

      //#then effort should be injected normally
      expect(output.options.effort).toBe("max")
    })
  })

  describe("existing options", () => {
    it("does not overwrite existing effort", async () => {
      const hook = createAnthropicEffortHook()
      const { input, output } = createMockParams({ existingOptions: { effort: "high" } })

      await hook["chat.params"](input, output)

      expect(output.options.effort).toBe("high")
    })
  })
})
