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
  describe("opus 4-6 with variant max", () => {
    it("should inject effort max for anthropic opus-4-6 with variant max", async () => {
      //#given anthropic opus-4-6 model with variant max
      const hook = createAnthropicEffortHook()
      const { input, output } = createMockParams({})

      //#when chat.params hook is called
      await hook["chat.params"](input, output)

      //#then effort should be injected into options
      expect(output.options.effort).toBe("max")
    })

    it("should inject effort max for github-copilot claude-opus-4-6", async () => {
      //#given github-copilot provider with claude-opus-4-6
      const hook = createAnthropicEffortHook()
      const { input, output } = createMockParams({
        providerID: "github-copilot",
        modelID: "claude-opus-4-6",
      })

      //#when chat.params hook is called
      await hook["chat.params"](input, output)

      //#then effort should be injected (github-copilot resolves to anthropic)
      expect(output.options.effort).toBe("max")
    })

    it("should inject effort max for opencode provider with claude-opus-4-6", async () => {
      //#given opencode provider with claude-opus-4-6
      const hook = createAnthropicEffortHook()
      const { input, output } = createMockParams({
        providerID: "opencode",
        modelID: "claude-opus-4-6",
      })

      //#when chat.params hook is called
      await hook["chat.params"](input, output)

      //#then effort should be injected
      expect(output.options.effort).toBe("max")
    })

    it("should handle normalized model ID with dots (opus-4.6)", async () => {
      //#given model ID with dots instead of hyphens
      const hook = createAnthropicEffortHook()
      const { input, output } = createMockParams({
        modelID: "claude-opus-4.6",
      })

      //#when chat.params hook is called
      await hook["chat.params"](input, output)

      //#then should normalize and inject effort
      expect(output.options.effort).toBe("max")
    })
  })

  describe("conditions NOT met - should skip", () => {
    it("should NOT inject effort when variant is not max", async () => {
      //#given opus-4-6 with variant high (not max)
      const hook = createAnthropicEffortHook()
      const { input, output } = createMockParams({ variant: "high" })

      //#when chat.params hook is called
      await hook["chat.params"](input, output)

      //#then effort should NOT be injected
      expect(output.options.effort).toBeUndefined()
    })

    it("should NOT inject effort when variant is undefined", async () => {
      //#given opus-4-6 with no variant
      const hook = createAnthropicEffortHook()
      const { input, output } = createMockParams({ variant: undefined })

      //#when chat.params hook is called
      await hook["chat.params"](input, output)

      //#then effort should NOT be injected
      expect(output.options.effort).toBeUndefined()
    })

    it("should NOT inject effort for non-opus model", async () => {
      //#given claude-sonnet-4-5 (not opus)
      const hook = createAnthropicEffortHook()
      const { input, output } = createMockParams({
        modelID: "claude-sonnet-4-5",
      })

      //#when chat.params hook is called
      await hook["chat.params"](input, output)

      //#then effort should NOT be injected
      expect(output.options.effort).toBeUndefined()
    })

    it("should NOT inject effort for non-anthropic provider with non-claude model", async () => {
      //#given openai provider with gpt model
      const hook = createAnthropicEffortHook()
      const { input, output } = createMockParams({
        providerID: "openai",
        modelID: "gpt-5.2",
      })

      //#when chat.params hook is called
      await hook["chat.params"](input, output)

      //#then effort should NOT be injected
      expect(output.options.effort).toBeUndefined()
    })

    it("should NOT throw when model.modelID is undefined", async () => {
      //#given model with undefined modelID (runtime edge case)
      const hook = createAnthropicEffortHook()
      const input = {
        sessionID: "test-session",
        agent: { name: "sisyphus" },
        model: { providerID: "anthropic", modelID: undefined as unknown as string },
        provider: { id: "anthropic" },
        message: { variant: "max" as const },
      }
      const output = { temperature: 0.1, options: {} }

      //#when chat.params hook is called with undefined modelID
      await hook["chat.params"](input, output)

      //#then should gracefully skip without throwing
      expect(output.options.effort).toBeUndefined()
    })
  })

  describe("preserves existing options", () => {
    it("should NOT overwrite existing effort if already set", async () => {
      //#given options already have effort set
      const hook = createAnthropicEffortHook()
      const { input, output } = createMockParams({
        existingOptions: { effort: "high" },
      })

      //#when chat.params hook is called
      await hook["chat.params"](input, output)

      //#then existing effort should be preserved
      expect(output.options.effort).toBe("high")
    })

    it("should preserve other existing options when injecting effort", async () => {
      //#given options with existing thinking config
      const hook = createAnthropicEffortHook()
      const { input, output } = createMockParams({
        existingOptions: {
          thinking: { type: "enabled", budgetTokens: 31999 },
        },
      })

      //#when chat.params hook is called
      await hook["chat.params"](input, output)

      //#then effort should be added without affecting thinking
      expect(output.options.effort).toBe("max")
      expect(output.options.thinking).toEqual({
        type: "enabled",
        budgetTokens: 31999,
      })
    })
  })
})
