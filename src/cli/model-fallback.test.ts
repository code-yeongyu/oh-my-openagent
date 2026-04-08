/// <reference types="bun-types" />

import { describe, expect, test, mock } from "bun:test"

mock.module("../shared/connected-providers-cache", () => ({
  readConnectedProvidersCache: () => null,
  readProviderModelsCache: () => null,
}))

import { generateModelConfig } from "./model-fallback"
import type { InstallConfig } from "./types"

function createConfig(overrides: Partial<InstallConfig> = {}): InstallConfig {
  return {
    hasClaude: false,
    isMax20: false,
    hasOpenAI: false,
    hasGemini: false,
    hasCopilot: false,
    hasOpencodeZen: false,
    hasZaiCodingPlan: false,
    hasKimiForCoding: false,
    hasOpencodeGo: false,
    ...overrides,
  }
}

describe("generateModelConfig", () => {
  describe("no providers available", () => {
    test("returns ULTIMATE_FALLBACK for all agents and categories when no providers", () => {
      const config = createConfig()
      const result = generateModelConfig(config)
      expect(result).toMatchSnapshot()
    })
  })

  describe("single native provider", () => {
    test("uses Claude models when only Claude is available", () => {
      const config = createConfig({ hasClaude: true })
      const result = generateModelConfig(config)
      expect(result).toMatchSnapshot()
    })

    test("uses Claude models with isMax20 flag", () => {
      const config = createConfig({ hasClaude: true, isMax20: true })
      const result = generateModelConfig(config)
      expect(result).toMatchSnapshot()
    })

    test("uses OpenAI models when only OpenAI is available", () => {
      const config = createConfig({ hasOpenAI: true })
      const result = generateModelConfig(config)
      expect(result).toMatchSnapshot()
    })

    test("uses OpenAI models with isMax20 flag", () => {
      const config = createConfig({ hasOpenAI: true, isMax20: true })
      const result = generateModelConfig(config)
      expect(result).toMatchSnapshot()
    })

    test("uses Gemini models when only Gemini is available", () => {
      const config = createConfig({ hasGemini: true })
      const result = generateModelConfig(config)
      expect(result).toMatchSnapshot()
    })

    test("uses Gemini models with isMax20 flag", () => {
      const config = createConfig({ hasGemini: true, isMax20: true })
      const result = generateModelConfig(config)
      expect(result).toMatchSnapshot()
    })
  })

  describe("all native providers", () => {
    test("uses preferred models from fallback chains when all natives available", () => {
      const config = createConfig({ hasClaude: true, hasOpenAI: true, hasGemini: true })
      const result = generateModelConfig(config)
      expect(result).toMatchSnapshot()
    })

    test("uses preferred models with isMax20 flag when all natives available", () => {
      const config = createConfig({ hasClaude: true, hasOpenAI: true, hasGemini: true, isMax20: true })
      const result = generateModelConfig(config)
      expect(result).toMatchSnapshot()
    })
  })

  describe("fallback providers", () => {
    test("uses OpenCode Zen models when only OpenCode Zen is available", () => {
      const config = createConfig({ hasOpencodeZen: true })
      const result = generateModelConfig(config)
      expect(result).toMatchSnapshot()
    })

    test("uses OpenCode Zen models with isMax20 flag", () => {
      const config = createConfig({ hasOpencodeZen: true, isMax20: true })
      const result = generateModelConfig(config)
      expect(result).toMatchSnapshot()
    })

    test("uses GitHub Copilot models when only Copilot is available", () => {
      const config = createConfig({ hasCopilot: true })
      const result = generateModelConfig(config)
      expect(result).toMatchSnapshot()
    })

    test("uses GitHub Copilot models with isMax20 flag", () => {
      const config = createConfig({ hasCopilot: true, isMax20: true })
      const result = generateModelConfig(config)
      expect(result).toMatchSnapshot()
    })

    test("uses ZAI model for librarian when only ZAI is available", () => {
      const config = createConfig({ hasZaiCodingPlan: true })
      const result = generateModelConfig(config)
      expect(result).toMatchSnapshot()
    })

    test("uses ZAI model for librarian with isMax20 flag", () => {
      const config = createConfig({ hasZaiCodingPlan: true, isMax20: true })
      const result = generateModelConfig(config)
      expect(result).toMatchSnapshot()
    })
  })

  describe("mixed provider scenarios", () => {
    test("uses Claude + OpenCode Zen combination", () => {
      const config = createConfig({ hasClaude: true, hasOpencodeZen: true })
      const result = generateModelConfig(config)
      expect(result).toMatchSnapshot()
    })

    test("uses OpenAI + Copilot combination", () => {
      const config = createConfig({ hasOpenAI: true, hasCopilot: true })
      const result = generateModelConfig(config)
      expect(result).toMatchSnapshot()
    })

    test("uses Claude + ZAI combination (librarian uses ZAI)", () => {
      const config = createConfig({ hasClaude: true, hasZaiCodingPlan: true })
      const result = generateModelConfig(config)
      expect(result).toMatchSnapshot()
    })

    test("uses Gemini + Claude combination (explore uses Gemini)", () => {
      const config = createConfig({ hasGemini: true, hasClaude: true })
      const result = generateModelConfig(config)
      expect(result).toMatchSnapshot()
    })

    test("uses all fallback providers together", () => {
      const config = createConfig({ hasOpencodeZen: true, hasCopilot: true, hasZaiCodingPlan: true })
      const result = generateModelConfig(config)
      expect(result).toMatchSnapshot()
    })

    test("uses all providers together", () => {
      const config = createConfig({
        hasClaude: true,
        hasOpenAI: true,
        hasGemini: true,
        hasOpencodeZen: true,
        hasCopilot: true,
        hasZaiCodingPlan: true,
      })
      const result = generateModelConfig(config)
      expect(result).toMatchSnapshot()
    })

    test("uses all providers with isMax20 flag", () => {
      const config = createConfig({
        hasClaude: true,
        hasOpenAI: true,
        hasGemini: true,
        hasOpencodeZen: true,
        hasCopilot: true,
        hasZaiCodingPlan: true,
        isMax20: true,
      })
      const result = generateModelConfig(config)
      expect(result).toMatchSnapshot()
    })
  })

  describe("explore agent special cases", () => {
    test("explore uses gpt-5-nano when only Gemini available (no Claude)", () => {
      const config = createConfig({ hasGemini: true })
      const result = generateModelConfig(config)
      expect(result.agents?.explore?.model).toBe("opencode/gpt-5-nano")
    })

    test("explore uses Claude haiku when Claude available", () => {
      const config = createConfig({ hasClaude: true, isMax20: true })
      const result = generateModelConfig(config)
      expect(result.agents?.explore?.model?.startsWith("anthropic/claude-haiku")).toBe(true)
    })

    test("explore uses Claude haiku regardless of isMax20 flag", () => {
      const config = createConfig({ hasClaude: true, isMax20: false })
      const result = generateModelConfig(config)
      expect(result.agents?.explore?.model?.startsWith("anthropic/claude-haiku")).toBe(true)
    })

    test("explore uses OpenAI model when only OpenAI available", () => {
      const config = createConfig({ hasOpenAI: true })
      const result = generateModelConfig(config)
      expect(result.agents?.explore?.model).toBe("openai/gpt-5.4")
      expect(result.agents?.explore?.variant).toBe("medium")
    })

    test("explore uses gpt-5-mini when only Copilot available", () => {
      const config = createConfig({ hasCopilot: true })
      const result = generateModelConfig(config)
      expect(result.agents?.explore?.model).toBe("github-copilot/gpt-5-mini")
    })
  })

  describe("Sisyphus agent special cases", () => {
    test("Sisyphus is created when at least one fallback provider is available (Claude)", () => {
      const config = createConfig({ hasClaude: true, isMax20: true })
      const result = generateModelConfig(config)
      expect(result.agents?.sisyphus?.model?.startsWith("anthropic/claude-opus")).toBe(true)
    })

    test("Sisyphus is created when multiple fallback providers are available", () => {
      const config = createConfig({
        hasClaude: true,
        hasKimiForCoding: true,
        hasOpencodeZen: true,
        hasZaiCodingPlan: true,
        isMax20: true,
      })
      const result = generateModelConfig(config)
      expect(result.agents?.sisyphus?.model?.startsWith("anthropic/claude-opus")).toBe(true)
    })

    test("Sisyphus resolves to gpt-5.4 medium when only OpenAI is available", () => {
      const config = createConfig({ hasOpenAI: true })
      const result = generateModelConfig(config)
      expect(result.agents?.sisyphus?.model).toBe("openai/gpt-5.4")
      expect(result.agents?.sisyphus?.variant).toBe("medium")
    })
  })
})
