/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { generateModelConfig, shouldShowChatGPTOnlyWarning } from "./model-fallback"
import type { InstallConfig } from "./types"

function createConfig(overrides: Partial<InstallConfig> = {}): InstallConfig {
  return {
    platform: "opencode",
    hasOpenCode: true,
    hasCodex: false,
    codexAutonomous: false,
    hasClaude: false,
    isMax20: false,
    hasOpenAI: false,
    hasGemini: false,
    hasCopilot: false,
    hasOpencodeZen: false,
    hasZaiCodingPlan: false,
    hasKimiForCoding: false,
    hasOpencodeGo: false,
      hasBailianCodingPlan: false,
    hasMinimaxCnCodingPlan: false,
    hasMinimaxCodingPlan: false,
    hasVercelAiGateway: false,
    ...overrides,
  }
}

function flattenConfiguredModels(result: ReturnType<typeof generateModelConfig>) {
  return [
    ...Object.values(result.agents ?? {}),
    ...Object.values(result.categories ?? {}),
  ].flatMap((entry) => [entry, ...(entry.fallback_models ?? [])])
}
describe("generateModelConfig", () => {

  describe("fallback providers", () => {

    test("downgrades unsupported GitHub Copilot GPT high-tier variants", () => {
      // #given only GitHub Copilot is available
      const config = createConfig({ hasCopilot: true })

      // #when generateModelConfig is called
      const result = generateModelConfig(config)

      // #then Copilot GPT routes should not receive variants that hang the provider
      const unsupportedEntries = flattenConfiguredModels(result).filter(
        (entry) =>
          entry.model.startsWith("github-copilot/gpt-5.") &&
          (entry.variant === "max" || entry.variant === "xhigh")
      )
      expect(unsupportedEntries).toEqual([])
      expect(result.agents?.momus).toEqual({
        model: "github-copilot/gpt-5.6-terra",
        variant: "high",
        fallback_models: [
          {
            model: "github-copilot/gpt-5.6-sol",
            variant: "high",
          },
          {
            model: "github-copilot/claude-opus-4.8",
            variant: "max",
          },
          {
            model: "github-copilot/gemini-3.1-pro-preview",
            variant: "high",
          },
        ],
      })
      expect(result.categories?.ultrabrain?.model).toBe("github-copilot/gpt-5.6-sol")
      expect(result.categories?.ultrabrain?.variant).toBe("high")
      expect(result.categories?.deep?.model).toBe("github-copilot/gpt-5.6-terra")
      expect(result.categories?.deep?.variant).toBe("high")
      expect(result.categories?.["unspecified-low"]?.model).toBe("github-copilot/gpt-5.6-luna")
      expect(result.categories?.["unspecified-low"]?.variant).toBe("high")
    })
    test("omits librarian when only ZAI is available", () => {
      // #given only ZAI is available
      const config = createConfig({ hasZaiCodingPlan: true })

      // #when generateModelConfig is called
      const result = generateModelConfig(config)

      // #then librarian should not use a stale ZAI special case
      expect(result.agents?.librarian).toBeUndefined()
      expect(JSON.stringify(result)).not.toContain("zai-coding-plan/glm-4.7")
    })

    test("omits librarian when only ZAI is available with isMax20 flag", () => {
      // #given ZAI is available with Max 20 plan
      const config = createConfig({ hasZaiCodingPlan: true, isMax20: true })

      // #when generateModelConfig is called
      const result = generateModelConfig(config)

      // #then librarian should not use a stale ZAI special case
      expect(result.agents?.librarian).toBeUndefined()
      expect(JSON.stringify(result)).not.toContain("zai-coding-plan/glm-4.7")
    })

    test("uses Bailian Qwen for utility agents when only Bailian is available", () => {
      // #given only Bailian Coding Plan is available
      const config = createConfig({ hasBailianCodingPlan: true })

      // #when generateModelConfig is called
      const result = generateModelConfig(config)

      // #then Bailian is limited to compatible utility routes
      expect(result.agents?.librarian?.model).toBe("bailian-coding-plan/qwen3.5-plus")
      expect(result.agents?.explore?.model).toBe("bailian-coding-plan/qwen3.5-plus")
      expect(result.agents?.hephaestus).toBeUndefined()
    })
  })

  describe("mixed provider scenarios", () => {

    test("librarian skips deprecated OpenCode Zen models when OpenCode Zen and ZAI are both available", () => {
      // #given the Discord-reported non-TUI provider selection
      const config = createConfig({
        hasOpencodeZen: true,
        hasZaiCodingPlan: true,
      })

      // #when generateModelConfig is called
      const result = generateModelConfig(config)

      // #then librarian should not route through stale Zen or ZAI special cases
      expect(result.agents?.librarian).toBeUndefined()
      expect(JSON.stringify(result)).not.toContain("zai-coding-plan/glm-4.7")
      expect(JSON.stringify(result)).not.toContain("opencode/claude-haiku-4-5")
      expect(JSON.stringify(result)).not.toContain("opencode/gpt-5.4-nano")
    })

  })

  describe("explore agent special cases", () => {
    test("explore uses gpt-5-nano when only Gemini available (no Claude)", () => {
      // #given only Gemini is available (no Claude)
      const config = createConfig({ hasGemini: true })

      // #when generateModelConfig is called
      const result = generateModelConfig(config)

      // #then explore should use gpt-5-nano (Claude haiku not available)
      expect(result.agents?.explore?.model).toBe("opencode/gpt-5-nano")
    })

    test("explore uses Claude haiku when Claude available", () => {
      // #given Claude is available
      const config = createConfig({ hasClaude: true, isMax20: true })

      // #when generateModelConfig is called
      const result = generateModelConfig(config)

      // #then explore should use claude-haiku-4-5
      expect(result.agents?.explore?.model).toBe("anthropic/claude-haiku-4-5")
    })

    test("explore uses Claude haiku regardless of isMax20 flag", () => {
      // #given Claude is available without Max 20 plan
      const config = createConfig({ hasClaude: true, isMax20: false })

      // #when generateModelConfig is called
      const result = generateModelConfig(config)

      // #then explore should use claude-haiku-4-5 (isMax20 doesn't affect explore)
      expect(result.agents?.explore?.model).toBe("anthropic/claude-haiku-4-5")
    })

    test("explore uses OpenAI model when only OpenAI available", () => {
      // #given only OpenAI is available
      const config = createConfig({ hasOpenAI: true })

      // #when generateModelConfig is called
      const result = generateModelConfig(config)

      // #then explore should use native OpenAI mini-fast (primary model)
      expect(result.agents?.explore?.model).toBe("openai/gpt-5.4-mini-fast")
      expect(result.agents?.explore?.variant).toBeUndefined()
    })

    test("explore uses gpt-5-mini when only Copilot available", () => {
      // #given only Copilot is available
      const config = createConfig({ hasCopilot: true })

      // #when generateModelConfig is called
      const result = generateModelConfig(config)

      // #then explore should use gpt-5-mini (Copilot fallback)
      expect(result.agents?.explore?.model).toBe("github-copilot/gpt-5-mini")
    })
  })

  describe("Sisyphus agent special cases", () => {
    test("Sisyphus is created when at least one fallback provider is available (Claude)", () => {
      // #given
      const config = createConfig({ hasClaude: true, isMax20: true })

      // #when
      const result = generateModelConfig(config)

      // #then
      expect(result.agents?.sisyphus?.model).toBe("anthropic/claude-opus-4-8")
    })

    test("Sisyphus is created when multiple fallback providers are available", () => {
      // #given
      const config = createConfig({
        hasClaude: true,
        hasKimiForCoding: true,
        hasOpencodeZen: true,
        hasZaiCodingPlan: true,
        isMax20: true,
      })

      // #when
      const result = generateModelConfig(config)

      // #then
      expect(result.agents?.sisyphus?.model).toBe("anthropic/claude-opus-4-8")
    })

    test("Sisyphus resolves to gpt-5.6-sol medium when only OpenAI is available", () => {
      // given
      const config = createConfig({ hasOpenAI: true })

      // when
      const result = generateModelConfig(config)

      // then
      expect(result.agents?.sisyphus).toEqual({
        model: "openai/gpt-5.6-sol",
        variant: "medium",
      })
    })
  })

  describe("OpenAI fallback coverage", () => {
    test("Atlas resolves to gpt-5.6-sol medium when only OpenAI is available", () => {
      // given
      const config = createConfig({ hasOpenAI: true })

      // when
      const result = generateModelConfig(config)

      // then
      expect(result.agents?.atlas).toEqual({
        model: "openai/gpt-5.6-sol",
        variant: "medium",
      })
    })

    test("Metis resolves to OpenAI when only OpenAI is available", () => {
      // #given
      const config = createConfig({ hasOpenAI: true })

      // #when
      const result = generateModelConfig(config)

      // #then
      expect(result.agents?.metis?.model).toBe("openai/gpt-5.6-sol")
      expect(result.agents?.metis?.variant).toBe("medium")
    })

    test("Sisyphus-Junior resolves to gpt-5.6-sol medium when only OpenAI is available", () => {
      // given
      const config = createConfig({ hasOpenAI: true })

      // when
      const result = generateModelConfig(config)

      // then
      expect(result.agents?.["sisyphus-junior"]).toEqual({
        model: "openai/gpt-5.6-sol",
        variant: "medium",
      })
    })
  })

  describe("Momus agent model resolution", () => {
    test("Momus resolves to gpt-5.6-terra high when OpenAI is available", () => {
      // #given
      const config = createConfig({ hasOpenAI: true })

      // #when
      const result = generateModelConfig(config)

      // #then
      expect(result.agents?.momus?.model).toBe("openai/gpt-5.6-terra")
      expect(result.agents?.momus?.variant).toBe("high")
      expect(result.agents?.momus?.fallback_models?.[0]).toEqual({
        model: "openai/gpt-5.6-sol",
        variant: "xhigh",
      })
    })
  })

})
