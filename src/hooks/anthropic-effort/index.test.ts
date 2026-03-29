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
  describe("opus 4.6+ — should inject effort max", () => {
    it("injects effort max for anthropic opus-4-6", async () => {
      const hook = createAnthropicEffortHook()
      const { input, output } = createMockParams({})

      await hook["chat.params"](input, output)

      expect(output.options.effort).toBe("max")
      expect(input.message.variant).toBe("max")
    })

    it("injects effort max for dotted opus-4.6", async () => {
      const hook = createAnthropicEffortHook()
      const { input, output } = createMockParams({ modelID: "claude-opus-4.6" })

      await hook["chat.params"](input, output)

      expect(output.options.effort).toBe("max")
      expect(input.message.variant).toBe("max")
    })

    it("injects effort max for opus-4-6 with date suffix", async () => {
      const hook = createAnthropicEffortHook()
      const { input, output } = createMockParams({ modelID: "claude-opus-4-6-20260301" })

      await hook["chat.params"](input, output)

      expect(output.options.effort).toBe("max")
      expect(input.message.variant).toBe("max")
    })

    it("injects effort max for future opus-5-0", async () => {
      const hook = createAnthropicEffortHook()
      const { input, output } = createMockParams({ modelID: "claude-opus-5-0" })

      await hook["chat.params"](input, output)

      expect(output.options.effort).toBe("max")
      expect(input.message.variant).toBe("max")
    })
  })

  describe("opus < 4.6 — should inject effort high", () => {
    it("clamps to high for opus-4-5", async () => {
      const hook = createAnthropicEffortHook()
      const { input, output } = createMockParams({ modelID: "claude-opus-4-5" })

      await hook["chat.params"](input, output)

      expect(output.options.effort).toBe("high")
      expect(input.message.variant).toBe("high")
    })

    it("clamps to high for opus-4-5 with date suffix", async () => {
      const hook = createAnthropicEffortHook()
      const { input, output } = createMockParams({ modelID: "claude-opus-4-5-20251101" })

      await hook["chat.params"](input, output)

      expect(output.options.effort).toBe("high")
      expect(input.message.variant).toBe("high")
    })
  })

  describe("sonnet 4.6+ — should inject effort high", () => {
    it("injects effort high for sonnet-4-6", async () => {
      const hook = createAnthropicEffortHook()
      const { input, output } = createMockParams({ modelID: "claude-sonnet-4-6" })

      await hook["chat.params"](input, output)

      expect(output.options.effort).toBe("high")
      expect(input.message.variant).toBe("high")
    })

    it("injects effort high for sonnet-4-6 with date suffix", async () => {
      const hook = createAnthropicEffortHook()
      const { input, output } = createMockParams({ modelID: "claude-sonnet-4-6-20260501" })

      await hook["chat.params"](input, output)

      expect(output.options.effort).toBe("high")
      expect(input.message.variant).toBe("high")
    })

    it("injects effort high for future sonnet-5-0", async () => {
      const hook = createAnthropicEffortHook()
      const { input, output } = createMockParams({ modelID: "claude-sonnet-5-0" })

      await hook["chat.params"](input, output)

      expect(output.options.effort).toBe("high")
      expect(input.message.variant).toBe("high")
    })
  })

  describe("unsupported models — should NOT inject effort", () => {
    it("skips haiku-4-5", async () => {
      const hook = createAnthropicEffortHook()
      const { input, output } = createMockParams({ modelID: "claude-haiku-4-5" })

      await hook["chat.params"](input, output)

      expect(output.options.effort).toBeUndefined()
      expect(input.message.variant).toBe("max")
    })

    it("skips haiku-4-5 with date suffix", async () => {
      const hook = createAnthropicEffortHook()
      const { input, output } = createMockParams({ modelID: "claude-haiku-4-5-20251001" })

      await hook["chat.params"](input, output)

      expect(output.options.effort).toBeUndefined()
      expect(input.message.variant).toBe("max")
    })

    it("skips sonnet-4 (date suffix, no real minor version)", async () => {
      const hook = createAnthropicEffortHook()
      const { input, output } = createMockParams({ modelID: "claude-sonnet-4-20250514" })

      await hook["chat.params"](input, output)

      expect(output.options.effort).toBeUndefined()
      expect(input.message.variant).toBe("max")
    })

    it("skips non-claude models", async () => {
      const hook = createAnthropicEffortHook()
      const { input, output } = createMockParams({ providerID: "openai", modelID: "gpt-5.4" })

      await hook["chat.params"](input, output)

      expect(output.options.effort).toBeUndefined()
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
