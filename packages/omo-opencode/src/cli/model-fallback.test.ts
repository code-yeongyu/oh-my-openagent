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

    test("Sisyphus is omitted when only OpenAI is available", () => {
      // given
      const config = createConfig({ hasOpenAI: true })

      // when
      const result = generateModelConfig(config)

      // then
      expect(result.agents?.sisyphus).toBeUndefined()
    })
  })

  describe("OpenAI fallback coverage", () => {
    test("Atlas falls back to OpenCode nano when only OpenAI is available", () => {
      // given
      const config = createConfig({ hasOpenAI: true })

      // when
      const result = generateModelConfig(config)

      // then
      expect(result.agents?.atlas).toEqual({ model: "opencode/gpt-5-nano" })
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

    test("Sisyphus-Junior falls back to OpenCode nano when only OpenAI is available", () => {
      // given
      const config = createConfig({ hasOpenAI: true })

      // when
      const result = generateModelConfig(config)

      // then
      expect(result.agents?.["sisyphus-junior"]).toEqual({ model: "opencode/gpt-5-nano" })
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

  describe("Hephaestus agent special cases", () => {
    test("Hephaestus is created when OpenAI is available (openai provider connected)", () => {
      // #given
      const config = createConfig({ hasOpenAI: true })

      // #when
      const result = generateModelConfig(config)

      // #then
      expect(result.agents?.hephaestus?.model).toBe("openai/gpt-5.6-sol")
      expect(result.agents?.hephaestus?.variant).toBe("medium")
    })

    test("Hephaestus uses its merged Copilot GPT-5.6 Sol medium rung", () => {
      // given
      const config = createConfig({ hasCopilot: true })

      // when
      const result = generateModelConfig(config)

      // then
      expect(result.agents?.hephaestus).toEqual({
        model: "github-copilot/gpt-5.6-sol",
        variant: "medium",
      })
    })

    test("Hephaestus is created when OpenCode Zen is available (opencode provider connected)", () => {
      // #given
      const config = createConfig({ hasOpencodeZen: true })

      // #when
      const result = generateModelConfig(config)

      // #then
      expect(result.agents?.hephaestus?.model).toBe("opencode/gpt-5.6-sol")
      expect(result.agents?.hephaestus?.variant).toBe("medium")
    })

    test("Hephaestus is omitted when only Claude is available (no required provider connected)", () => {
      // #given
      const config = createConfig({ hasClaude: true })

      // #when
      const result = generateModelConfig(config)

      // #then
      expect(result.agents?.hephaestus).toBeUndefined()
    })

    test("Hephaestus is omitted when only Gemini is available (no required provider connected)", () => {
      // #given
      const config = createConfig({ hasGemini: true })

      // #when
      const result = generateModelConfig(config)

      // #then
      expect(result.agents?.hephaestus).toBeUndefined()
    })

    test("Hephaestus is omitted when only ZAI is available (no required provider connected)", () => {
      // #given
      const config = createConfig({ hasZaiCodingPlan: true })

      // #when
      const result = generateModelConfig(config)

      // #then
      expect(result.agents?.hephaestus).toBeUndefined()
    })
  })

  describe("librarian agent special cases", () => {
    test("librarian uses Claude fallback when ZAI is available with Claude", () => {
      // #given ZAI and Claude are available
      const config = createConfig({
        hasClaude: true,
        hasZaiCodingPlan: true,
      })

      // #when generateModelConfig is called
      const result = generateModelConfig(config)

      // #then librarian should not use a stale ZAI special case
      expect(result.agents?.librarian?.model).toBe("anthropic/claude-haiku-4-5")
      expect(JSON.stringify(result)).not.toContain("zai-coding-plan/glm-4.7")
    })

    test("librarian uses Claude fallback when Claude is available", () => {
      // #given only Claude is available (no opencode-go or ZAI)
      const config = createConfig({ hasClaude: true })

      // #when generateModelConfig is called
      const result = generateModelConfig(config)

      // #then librarian should use its shared fallback chain
      expect(result.agents?.librarian?.model).toBe("anthropic/claude-haiku-4-5")
    })
  })

  describe("special-case agents include fallback_models", () => {
    test("explore includes fallback_models when OpenAI and Claude are both available", () => {
      // #given both OpenAI and Claude are available
      const config = createConfig({ hasOpenAI: true, hasClaude: true })

      // #when generateModelConfig is called
      const result = generateModelConfig(config)

      // #then explore should have fallback_models from the remaining chain entries
      expect(result.agents?.explore?.model).toBe("openai/gpt-5.4-mini-fast")
      expect(result.agents?.explore?.fallback_models).toBeDefined()
      expect(result.agents?.explore?.fallback_models?.length).toBeGreaterThan(0)
    })

    test("explore omits fallback_models when only one provider matches chain entries", () => {
      // #given only Claude is available
      const config = createConfig({ hasClaude: true })

      // #when generateModelConfig is called
      const result = generateModelConfig(config)

      // #then explore should not have fallback_models (only one distinct chain entry matches)
      expect(result.agents?.explore?.model).toBe("anthropic/claude-haiku-4-5")
      expect(result.agents?.explore?.fallback_models).toBeUndefined()
    })

    test("explore uses current OpenCode Zen nano model when only OpenCode Zen is available", () => {
      // #given only OpenCode Zen is available
      const config = createConfig({ hasOpencodeZen: true })

      // #when generateModelConfig is called
      const result = generateModelConfig(config)

      // #then Explore does not route to deprecated OpenCode Zen Haiku
      expect(result.agents?.explore?.model).toBe("opencode/gpt-5-nano")
      expect(JSON.stringify(result)).not.toContain("opencode/claude-haiku-4-5")
      expect(JSON.stringify(result)).not.toContain("opencode/gpt-5.4-nano")
    })

    test("generated config never routes deprecated fallback IDs through opencode", () => {
      // #given every provider family is available
      const config = createConfig({
        hasOpenAI: true,
        hasClaude: true,
        hasGemini: true,
        hasOpencodeZen: true,
        hasOpencodeGo: true,
        hasCopilot: true,
        hasZaiCodingPlan: true,
        hasVercelAiGateway: true,
      })

      // #when generateModelConfig is called
      const result = generateModelConfig(config)

      // #then no generated model string uses OpenCode Zen for retired IDs
      expect(JSON.stringify(result)).not.toContain("opencode/claude-haiku-4-5")
      expect(JSON.stringify(result)).not.toContain("opencode/gpt-5.4-nano")
    })

    test("librarian includes fallback_models when OpenAI and opencode-go are both available", () => {
      // #given OpenAI and opencode-go are available
      const config = createConfig({ hasOpenAI: true, hasOpencodeGo: true })

      // #when generateModelConfig is called
      const result = generateModelConfig(config)

      // #then librarian should have fallback_models
      expect(result.agents?.librarian?.model).toBe("openai/gpt-5.4-mini-fast")
      expect(result.agents?.librarian?.fallback_models).toBeDefined()
      expect(result.agents?.librarian?.fallback_models?.length).toBeGreaterThan(0)
    })

    test("librarian is omitted when only ZAI is available", () => {
      // #given only ZAI is available
      const config = createConfig({ hasZaiCodingPlan: true })

      // #when generateModelConfig is called
      const result = generateModelConfig(config)

      // #then librarian should not have fallback_models
      expect(result.agents?.librarian).toBeUndefined()
      expect(JSON.stringify(result)).not.toContain("zai-coding-plan/glm-4.7")
    })
  })

  describe("Vercel AI Gateway provider", () => {

    test("explore uses vercel/minimax/minimax-m2.7-highspeed when only gateway available", () => {
      // #given only Vercel AI Gateway is available
      const config = createConfig({ hasVercelAiGateway: true })

      // #when generateModelConfig is called
      const result = generateModelConfig(config)

      // #then explore should use gateway-routed minimax (preferred over claude-haiku)
      expect(result.agents?.explore?.model).toBe("vercel/minimax/minimax-m2.7-highspeed")
    })

    test("librarian uses vercel/minimax/minimax-m2.7-highspeed when only gateway available", () => {
      // #given only Vercel AI Gateway is available
      const config = createConfig({ hasVercelAiGateway: true })

      // #when generateModelConfig is called
      const result = generateModelConfig(config)

      // #then librarian should use gateway-routed highspeed minimax
      expect(result.agents?.librarian?.model).toBe("vercel/minimax/minimax-m2.7-highspeed")
    })

    test("Hephaestus is created when only Vercel AI Gateway is available", () => {
      // #given only Vercel AI Gateway is available
      const config = createConfig({ hasVercelAiGateway: true })

      // #when generateModelConfig is called
      const result = generateModelConfig(config)

      // #then hephaestus should be created with gateway-routed gpt-5.6-sol
      expect(result.agents?.hephaestus?.model).toBe("vercel/openai/gpt-5.6-sol")
    })

    test("native providers take priority over gateway", () => {
      // #given Claude and Vercel AI Gateway are both available
      const config = createConfig({ hasClaude: true, hasVercelAiGateway: true })

      // #when generateModelConfig is called
      const result = generateModelConfig(config)

      // #then should prefer native anthropic over gateway
      expect(result.agents?.sisyphus?.model).toBe("anthropic/claude-opus-4-8")
    })
  })

  describe("MiniMax Coding Plan providers", () => {
    test("uses minimax.io MiniMax-M3 when only MiniMax Coding Plan is available", () => {
      // #given only MiniMax Coding Plan is available
      const config = createConfig({ hasMinimaxCodingPlan: true })

      // #when generateModelConfig is called
      const result = generateModelConfig(config)

      // #then utility agents should use MiniMax-M3 through minimax.io
      expect(result.agents?.librarian?.model).toBe("minimax-coding-plan/MiniMax-M3")
      expect(result.agents?.explore?.model).toBe("minimax-coding-plan/MiniMax-M3")
      expect(result.agents?.atlas?.model).toBe("minimax-coding-plan/MiniMax-M3")
      expect(result.agents?.["sisyphus-junior"]?.model).toBe("minimax-coding-plan/MiniMax-M3")
      expect(result.categories?.writing?.model).toBe("minimax-coding-plan/MiniMax-M3")
    })

    test("keeps opencode-go MiniMax M3 ahead of Coding Plan fallback when both are available", () => {
      // #given OpenCode Go and MiniMax Coding Plan are both available
      const config = createConfig({ hasOpencodeGo: true, hasMinimaxCodingPlan: true })

      // #when generateModelConfig is called
      const result = generateModelConfig(config)

      // #then OpenCode Go stays primary and MiniMax M3 ordering is preserved in fallbacks
      expect(result.agents?.atlas?.model).toBe("opencode-go/kimi-k3")
      expect(result.agents?.atlas?.fallback_models?.[0]?.model).toBe("opencode-go/minimax-m3")
      expect(result.agents?.atlas?.fallback_models?.[1]?.model).toBe("minimax-coding-plan/MiniMax-M3")
      expect(result.agents?.atlas?.fallback_models?.[2]?.model).toBe("opencode-go/minimax-m2.7")
    })

    test("uses minimaxi.com MiniMax-M3 when only MiniMax CN Coding Plan is available", () => {
      // #given only MiniMax CN Coding Plan is available
      const config = createConfig({ hasMinimaxCnCodingPlan: true })

      // #when generateModelConfig is called
      const result = generateModelConfig(config)

      // #then utility agents should use MiniMax-M3 through minimaxi.com
      expect(result.agents?.librarian?.model).toBe("minimax-cn-coding-plan/MiniMax-M3")
      expect(result.agents?.explore?.model).toBe("minimax-cn-coding-plan/MiniMax-M3")
      expect(result.categories?.quick?.model).toBe("minimax-cn-coding-plan/MiniMax-M3")
    })
  })

  describe("schema URL", () => {
    test("always includes correct schema URL", () => {
      // #given any config
      const config = createConfig()

      // #when generateModelConfig is called
      const result = generateModelConfig(config)

      // #then should include correct schema URL
      expect(result.$schema).toBe(
        "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/oh-my-opencode.schema.json"
      )
    })
  })
})

describe("shouldShowChatGPTOnlyWarning", () => {
  test("returns true when OpenAI is the only configured provider", () => {
    // #given
    const config = createConfig({ hasOpenAI: true })

    // #when
    const result = shouldShowChatGPTOnlyWarning(config)

    // #then
    expect(result).toBe(true)
  })

  const mixedProviderCases: Array<{ name: string; overrides: Partial<InstallConfig> }> = [
    { name: "Claude", overrides: { hasClaude: true } },
    { name: "Gemini", overrides: { hasGemini: true } },
    { name: "Copilot", overrides: { hasCopilot: true } },
    { name: "OpenCode Zen", overrides: { hasOpencodeZen: true } },
    { name: "Z.ai Coding Plan", overrides: { hasZaiCodingPlan: true } },
    { name: "Kimi for Coding", overrides: { hasKimiForCoding: true } },
    { name: "OpenCode Go", overrides: { hasOpencodeGo: true } },
    { name: "Bailian Coding Plan", overrides: { hasBailianCodingPlan: true } },
    { name: "MiniMax CN Coding Plan", overrides: { hasMinimaxCnCodingPlan: true } },
    { name: "MiniMax Coding Plan", overrides: { hasMinimaxCodingPlan: true } },
    { name: "Vercel AI Gateway", overrides: { hasVercelAiGateway: true } },
  ]

  for (const { name, overrides } of mixedProviderCases) {
    test(`returns false when OpenAI is configured with ${name}`, () => {
      // #given
      const config = createConfig({ hasOpenAI: true, ...overrides })

      // #when
      const result = shouldShowChatGPTOnlyWarning(config)

      // #then
      expect(result).toBe(false)
    })
  }
})
