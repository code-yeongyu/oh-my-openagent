import { describe, expect, it } from "vitest"
import { createUltraworkModelOverrideHook } from "./hook"

interface ChatParamsInput {
  agent: string
  message: {
    variant: string
    model?: { providerID?: string; modelID?: string }
  }
  sessionID?: string
}

interface ChatParamsOutput {
  // Not used by this hook
}

function createMockParams(overrides: {
  agent?: string
  variant?: string
  model?: { providerID?: string; modelID?: string }
  sessionID?: string
}): { input: ChatParamsInput; output: ChatParamsOutput } {
  const agent = overrides.agent ?? "sisyphus"
  const variant = overrides.variant ?? "max"
  const model = overrides.model
  const sessionID = overrides.sessionID

  return {
    input: {
      agent,
      message: { variant, model },
      sessionID,
    },
    output: {},
  }
}

describe("createUltraworkModelOverrideHook", () => {
  describe("model swap works", () => {
    it("variant max, ultrawork config exists → model swapped", async () => {
      // given
      const agents = {
        sisyphus: {
          ultrawork: {
            model: "openai/gpt-5.2",
          },
        },
      }
      const hook = createUltraworkModelOverrideHook({ agents })
      const { input, output } = createMockParams({})

      // when
      await hook["chat.params"](input, output)

      // then
      expect(input.message.model).toEqual({
        providerID: "openai",
        modelID: "gpt-5.2",
      })
    })
  })

  describe("no-op on non-max variant", () => {
    it("variant high → model unchanged", async () => {
      // given
      const agents = {
        sisyphus: {
          ultrawork: {
            model: "openai/gpt-5.2",
          },
        },
      }
      const hook = createUltraworkModelOverrideHook({ agents })
      const { input, output } = createMockParams({ variant: "high" })

      // when
      await hook["chat.params"](input, output)

      // then
      expect(input.message.model).toBeUndefined()
    })
  })

  describe("no-op without config", () => {
    it("agent has no ultrawork config → model unchanged", async () => {
      // given
      const agents = {
        hephaestus: {
          ultrawork: {
            model: "openai/gpt-5.2",
          },
        },
      }
      const hook = createUltraworkModelOverrideHook({ agents })
      const { input, output } = createMockParams({})

      // when
      await hook["chat.params"](input, output)

      // then
      expect(input.message.model).toBeUndefined()
    })
  })

  describe("empty ultrawork config", () => {
    it("ultrawork: {} → no-op (model required)", async () => {
      // given
      const agents = {
        sisyphus: {
          ultrawork: undefined,
        },
      }
      const hook = createUltraworkModelOverrideHook({ agents })
      const { input, output } = createMockParams({})

      // when
      await hook["chat.params"](input, output)

      // then
      expect(input.message.model).toBeUndefined()
    })
  })

  describe("model string parsing", () => {
    it("openai/gpt-5.2 → { providerID: openai, modelID: gpt-5.2 }", async () => {
      // given
      const agents = {
        sisyphus: {
          ultrawork: {
            model: "openai/gpt-5.2",
          },
        },
      }
      const hook = createUltraworkModelOverrideHook({ agents })
      const { input, output } = createMockParams({})

      // when
      await hook["chat.params"](input, output)

      // then
      expect(input.message.model).toEqual({
        providerID: "openai",
        modelID: "gpt-5.2",
      })
    })
  })

  describe("nested slashes", () => {
    it("google-vertex-anthropic/claude-opus-4-6 → { providerID: google-vertex-anthropic, modelID: claude-opus-4-6 } (first / only)", async () => {
      // given
      const agents = {
        sisyphus: {
          ultrawork: {
            model: "google-vertex-anthropic/claude-opus-4-6",
          },
        },
      }
      const hook = createUltraworkModelOverrideHook({ agents })
      const { input, output } = createMockParams({})

      // when
      await hook["chat.params"](input, output)

      // then
      expect(input.message.model).toEqual({
        providerID: "google-vertex-anthropic",
        modelID: "claude-opus-4-6",
      })
    })
  })

  describe("variant override", () => {
    it("ultrawork.variant exists → message.variant updated", async () => {
      // given
      const agents = {
        sisyphus: {
          ultrawork: {
            model: "openai/gpt-5.2",
            variant: "high",
          },
        },
      }
      const hook = createUltraworkModelOverrideHook({ agents })
      const { input, output } = createMockParams({})

      // when
      await hook["chat.params"](input, output)

      // then
      expect(input.message.variant).toBe("high")
    })
  })

  describe("agent name normalization", () => {
    it("Sisyphus (Ultraworker) → sisyphus config key lookup", async () => {
      // given
      const agents = {
        sisyphus: {
          ultrawork: {
            model: "openai/gpt-5.2",
          },
        },
      }
      const hook = createUltraworkModelOverrideHook({ agents })
      const { input, output } = createMockParams({ agent: "Sisyphus (Ultraworker)" })

      // when
      await hook["chat.params"](input, output)

      // then
      expect(input.message.model).toEqual({
        providerID: "openai",
        modelID: "gpt-5.2",
      })
    })
  })
})