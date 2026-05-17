import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"

import { _resetProviderAuthCacheForTesting } from "../../shared/opencode-provider-auth"
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
  const modelID = overrides.modelID ?? "claude-opus-4-7"
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
      const { input, output } = createMockParams({ modelID: "claude-opus-4.7" })

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

    it("#given github-copilot + claude opus model #then effort clamped to high (constrained provider)", async () => {
      // given
      const hook = createAnthropicEffortHook()
      const { input, output } = createMockParams({
        providerID: "github-copilot",
        modelID: "claude-opus-4-7",
      })

      // when
      await hook["chat.params"](input, output)

      // then — github-copilot is a constrained provider, clamps max→high
      expect(output.options.effort).toBe("high")
      expect(input.message.variant).toBe("high")
    })

    it("#given github-copilot + claude sonnet model #then effort clamped to high", async () => {
      // given
      const hook = createAnthropicEffortHook()
      const { input, output } = createMockParams({
        providerID: "github-copilot",
        modelID: "claude-sonnet-4-6",
      })

      // when
      await hook["chat.params"](input, output)

      // then
      expect(output.options.effort).toBe("high")
      expect(input.message.variant).toBe("high")
    })

    describe("#given haiku models (effort unsupported)", () => {
      const haikuModels = [
        "claude-haiku-4-5",
        "claude-haiku-4.6",
        "claude-haiku",
        "claude-haiku-20240307",
      ]

      for (const modelID of haikuModels) {
        it(`skips effort injection for ${modelID}`, async () => {
          // given
          const hook = createAnthropicEffortHook()
          const { input, output } = createMockParams({ modelID })

          // when
          await hook["chat.params"](input, output)

          // then
          expect(output.options.effort).toBeUndefined()
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

  describe("#given anthropic OAuth auth (Claude Pro/Max) — regression for #3429", () => {
    let tempDataDir: string
    const originalXdgDataHome = process.env.XDG_DATA_HOME

    function writeAuthFile(providerEntries: Record<string, Record<string, unknown>>): void {
      const opencodeDir = path.join(tempDataDir, "opencode")
      mkdirSync(opencodeDir, { recursive: true })
      writeFileSync(path.join(opencodeDir, "auth.json"), JSON.stringify(providerEntries), "utf-8")
      _resetProviderAuthCacheForTesting()
    }

    beforeAll(() => {
      tempDataDir = path.join(tmpdir(), `anthropic-effort-oauth-${Date.now()}-${Math.random().toString(36).slice(2)}`)
      mkdirSync(tempDataDir, { recursive: true })
      process.env.XDG_DATA_HOME = tempDataDir
    })

    afterAll(() => {
      if (originalXdgDataHome === undefined) {
        delete process.env.XDG_DATA_HOME
      } else {
        process.env.XDG_DATA_HOME = originalXdgDataHome
      }
      rmSync(tempDataDir, { recursive: true, force: true })
      _resetProviderAuthCacheForTesting()
    })

    afterEach(() => {
      _resetProviderAuthCacheForTesting()
    })

    it("clamps opus-4-6 + max to high when anthropic provider uses oauth", async () => {
      // given an Anthropic OAuth session and variant=max on an Opus model
      writeAuthFile({ anthropic: { type: "oauth" } })
      const hook = createAnthropicEffortHook()
      const { input, output } = createMockParams({ modelID: "claude-opus-4-7" })

      // when chat.params fires
      await hook["chat.params"](input, output)

      // then effort must be clamped to high so Anthropic's OAuth API accepts it
      expect(output.options.effort).toBe("high")
      expect(input.message.variant).toBe("high")
    })

    it("clamps dotted opus id + max to high under OAuth", async () => {
      // given an Anthropic OAuth session and a dotted opus id
      writeAuthFile({ anthropic: { type: "oauth" } })
      const hook = createAnthropicEffortHook()
      const { input, output } = createMockParams({ modelID: "claude-opus-4.7" })

      // when chat.params fires
      await hook["chat.params"](input, output)

      // then effort must be clamped to high
      expect(output.options.effort).toBe("high")
      expect(input.message.variant).toBe("high")
    })

    it("still injects effort=max when anthropic auth is an API key", async () => {
      // given an Anthropic API-key session (not OAuth)
      writeAuthFile({ anthropic: { type: "api", key: "sk-ant-xxx" } })
      const hook = createAnthropicEffortHook()
      const { input, output } = createMockParams({ modelID: "claude-opus-4-7" })

      // when chat.params fires
      await hook["chat.params"](input, output)

      // then API-key users keep the original max behaviour for Opus
      expect(output.options.effort).toBe("max")
      expect(input.message.variant).toBe("max")
    })

    it("does not clamp when OAuth belongs to a different provider", async () => {
      // given OAuth entries for unrelated providers only
      writeAuthFile({ "github-copilot": { type: "oauth" }, opencode: { type: "api", key: "sk-x" } })
      const hook = createAnthropicEffortHook()
      const { input, output } = createMockParams({ modelID: "claude-opus-4-7", providerID: "anthropic" })

      // when chat.params fires for the anthropic provider
      await hook["chat.params"](input, output)

      // then max stays because anthropic itself is not OAuth
      expect(output.options.effort).toBe("max")
      expect(input.message.variant).toBe("max")
    })
  })
})
