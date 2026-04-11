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

    describe("#given internal hidden agents", () => {
      const internalAgents = ["title", "summary", "compaction"] as const

      for (const agentName of internalAgents) {
        it(`skips effort injection for ${agentName} agent`, async () => {
          // given
          const hook = createAnthropicEffortHook()
          const { input, output } = createMockParams({ agentName })

          // when
          await hook["chat.params"](input, output)

          // then
          expect(output.options.effort).toBeUndefined()
          expect(input.message.variant).toBe("max")
        })
      }
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

    describe("#given models that do not support effort parameter", () => {
      const unsupportedModels = [
        "claude-haiku-4-5",
        "claude-3-haiku",
        "claude-3-5-haiku",
        "claude-haiku-4.5",
        "anthropic/claude-haiku-4-5",
      ] as const

      for (const modelID of unsupportedModels) {
        it(`skips effort injection for ${modelID} (does not support effort)`, async () => {
          // given - haiku model with variant max
          const hook = createAnthropicEffortHook()
          const { input, output } = createMockParams({ modelID })

          // when
          await hook["chat.params"](input, output)

          // then - effort should NOT be injected
          expect(output.options.effort).toBeUndefined()
          // variant should remain unchanged (not mutated)
          expect(input.message.variant).toBe("max")
        })
      }
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
