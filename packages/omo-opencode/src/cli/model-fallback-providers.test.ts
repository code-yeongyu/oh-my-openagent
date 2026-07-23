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

describe("generateModelConfig provider routes", () => {
  describe("Hephaestus agent special cases", () => {
    test("Hephaestus is created when OpenAI is available (openai provider connected)", () => {
      // given only OpenAI is available
      const config = createConfig({ hasOpenAI: true })

      // when the generated model config is resolved
      const result = generateModelConfig(config)

      // then Hephaestus uses the native Sol route
      expect(result.agents?.hephaestus?.model).toBe("openai/gpt-5.6-sol")
      expect(result.agents?.hephaestus?.variant).toBe("medium")
    })

    test("Hephaestus uses its merged Copilot GPT-5.6 Sol medium rung", () => {
      // given only GitHub Copilot is available
      const config = createConfig({ hasCopilot: true })

      // when the generated model config is resolved
      const result = generateModelConfig(config)

      // then Hephaestus uses the supported Copilot effort
      expect(result.agents?.hephaestus).toEqual({
        model: "github-copilot/gpt-5.6-sol",
        variant: "medium",
      })
    })

    test("Hephaestus is created when OpenCode Zen is available (opencode provider connected)", () => {
      // given only OpenCode Zen is available
      const config = createConfig({ hasOpencodeZen: true })

      // when the generated model config is resolved
      const result = generateModelConfig(config)

      // then Hephaestus uses the OpenCode Sol route
      expect(result.agents?.hephaestus?.model).toBe("opencode/gpt-5.6-sol")
      expect(result.agents?.hephaestus?.variant).toBe("medium")
    })

    test("Hephaestus is omitted when only Claude is available", () => {
      // given only Claude is available
      const config = createConfig({ hasClaude: true })

      // when the generated model config is resolved
      const result = generateModelConfig(config)

      // then Hephaestus has no eligible provider
      expect(result.agents?.hephaestus).toBeUndefined()
    })

    test("Hephaestus is omitted when only Gemini is available", () => {
      // given only Gemini is available
      const config = createConfig({ hasGemini: true })

      // when the generated model config is resolved
      const result = generateModelConfig(config)

      // then Hephaestus has no eligible provider
      expect(result.agents?.hephaestus).toBeUndefined()
    })

    test("Hephaestus is omitted when only ZAI is available", () => {
      // given only ZAI is available
      const config = createConfig({ hasZaiCodingPlan: true })

      // when the generated model config is resolved
      const result = generateModelConfig(config)

      // then Hephaestus has no eligible provider
      expect(result.agents?.hephaestus).toBeUndefined()
    })
  })

  describe("librarian agent special cases", () => {
    test("librarian uses Claude fallback when ZAI is available with Claude", () => {
      // given Claude and ZAI are available
      const config = createConfig({ hasClaude: true, hasZaiCodingPlan: true })

      // when the generated model config is resolved
      const result = generateModelConfig(config)

      // then Librarian uses the current Claude fallback
      expect(result.agents?.librarian?.model).toBe("anthropic/claude-haiku-4-5")
      expect(JSON.stringify(result)).not.toContain("zai-coding-plan/glm-4.7")
    })

    test("librarian uses Claude fallback when Claude is available", () => {
      // given only Claude is available
      const config = createConfig({ hasClaude: true })

      // when the generated model config is resolved
      const result = generateModelConfig(config)

      // then Librarian uses the shared Claude fallback
      expect(result.agents?.librarian?.model).toBe("anthropic/claude-haiku-4-5")
    })
  })

  describe("special-case agents include fallback_models", () => {
    test("explore includes fallback_models when OpenAI and Claude are both available", () => {
      // given OpenAI and Claude are available
      const config = createConfig({ hasOpenAI: true, hasClaude: true })

      // when the generated model config is resolved
      const result = generateModelConfig(config)

      // then Explore includes its remaining fallbacks
      expect(result.agents?.explore?.model).toBe("openai/gpt-5.4-mini-fast")
      expect(result.agents?.explore?.fallback_models).toBeDefined()
      expect(result.agents?.explore?.fallback_models?.length).toBeGreaterThan(0)
    })

    test("explore omits fallback_models when only one provider matches chain entries", () => {
      // given only Claude is available
      const config = createConfig({ hasClaude: true })

      // when the generated model config is resolved
      const result = generateModelConfig(config)

      // then Explore has no remaining fallback
      expect(result.agents?.explore?.model).toBe("anthropic/claude-haiku-4-5")
      expect(result.agents?.explore?.fallback_models).toBeUndefined()
    })

    test("explore uses current OpenCode Zen nano model when only OpenCode Zen is available", () => {
      // given only OpenCode Zen is available
      const config = createConfig({ hasOpencodeZen: true })

      // when the generated model config is resolved
      const result = generateModelConfig(config)

      // then Explore avoids retired OpenCode identifiers
      expect(result.agents?.explore?.model).toBe("opencode/gpt-5-nano")
      expect(JSON.stringify(result)).not.toContain("opencode/claude-haiku-4-5")
      expect(JSON.stringify(result)).not.toContain("opencode/gpt-5.4-nano")
    })

    test("generated config never routes deprecated fallback IDs through opencode", () => {
      // given every provider family is available
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

      // when the generated model config is resolved
      const result = generateModelConfig(config)

      // then no route uses a retired OpenCode identifier
      expect(JSON.stringify(result)).not.toContain("opencode/claude-haiku-4-5")
      expect(JSON.stringify(result)).not.toContain("opencode/gpt-5.4-nano")
    })

    test("librarian includes fallback_models when OpenAI and opencode-go are both available", () => {
      // given OpenAI and OpenCode Go are available
      const config = createConfig({ hasOpenAI: true, hasOpencodeGo: true })

      // when the generated model config is resolved
      const result = generateModelConfig(config)

      // then Librarian includes its remaining fallbacks
      expect(result.agents?.librarian?.model).toBe("openai/gpt-5.4-mini-fast")
      expect(result.agents?.librarian?.fallback_models).toBeDefined()
      expect(result.agents?.librarian?.fallback_models?.length).toBeGreaterThan(0)
    })

    test("librarian is omitted when only ZAI is available", () => {
      // given only ZAI is available
      const config = createConfig({ hasZaiCodingPlan: true })

      // when the generated model config is resolved
      const result = generateModelConfig(config)

      // then Librarian has no current compatible route
      expect(result.agents?.librarian).toBeUndefined()
      expect(JSON.stringify(result)).not.toContain("zai-coding-plan/glm-4.7")
    })
  })

  describe("Vercel AI Gateway provider", () => {
    test("explore uses gateway minimax when only gateway is available", () => {
      // given only Vercel AI Gateway is available
      const config = createConfig({ hasVercelAiGateway: true })

      // when the generated model config is resolved
      const result = generateModelConfig(config)

      // then Explore uses the gateway Minimax route
      expect(result.agents?.explore?.model).toBe("vercel/minimax/minimax-m2.7-highspeed")
    })

    test("librarian uses gateway minimax when only gateway is available", () => {
      // given only Vercel AI Gateway is available
      const config = createConfig({ hasVercelAiGateway: true })

      // when the generated model config is resolved
      const result = generateModelConfig(config)

      // then Librarian uses the gateway Minimax route
      expect(result.agents?.librarian?.model).toBe("vercel/minimax/minimax-m2.7-highspeed")
    })

    test("Hephaestus uses gateway GPT-5.6 Sol when only gateway is available", () => {
      // given only Vercel AI Gateway is available
      const config = createConfig({ hasVercelAiGateway: true })

      // when the generated model config is resolved
      const result = generateModelConfig(config)

      // then Hephaestus uses gateway GPT-5.6 Sol
      expect(result.agents?.hephaestus?.model).toBe("vercel/openai/gpt-5.6-sol")
    })

    test("native providers take priority over gateway", () => {
      // given Claude and Vercel AI Gateway are available
      const config = createConfig({ hasClaude: true, hasVercelAiGateway: true })

      // when the generated model config is resolved
      const result = generateModelConfig(config)

      // then the native provider stays primary
      expect(result.agents?.sisyphus?.model).toBe("anthropic/claude-opus-4-8")
    })
  })

  describe("MiniMax Coding Plan providers", () => {
    test("uses minimax.io MiniMax-M3 when only MiniMax Coding Plan is available", () => {
      // given only MiniMax Coding Plan is available
      const config = createConfig({ hasMinimaxCodingPlan: true })

      // when the generated model config is resolved
      const result = generateModelConfig(config)

      // then utility routes use the global MiniMax provider
      expect(result.agents?.librarian?.model).toBe("minimax-coding-plan/MiniMax-M3")
      expect(result.agents?.explore?.model).toBe("minimax-coding-plan/MiniMax-M3")
      expect(result.agents?.atlas?.model).toBe("minimax-coding-plan/MiniMax-M3")
      expect(result.agents?.["sisyphus-junior"]?.model).toBe("minimax-coding-plan/MiniMax-M3")
      expect(result.categories?.writing?.model).toBe("minimax-coding-plan/MiniMax-M3")
    })

    test("keeps opencode-go MiniMax M3 ahead of Coding Plan fallback when both are available", () => {
      // given OpenCode Go and MiniMax Coding Plan are available
      const config = createConfig({ hasOpencodeGo: true, hasMinimaxCodingPlan: true })

      // when the generated model config is resolved
      const result = generateModelConfig(config)

      // then OpenCode Go remains ahead of the Coding Plan fallback
      expect(result.agents?.atlas?.model).toBe("opencode-go/kimi-k3")
      expect(result.agents?.atlas?.fallback_models?.[0]?.model).toBe("opencode-go/minimax-m3")
      expect(result.agents?.atlas?.fallback_models?.[1]?.model).toBe("minimax-coding-plan/MiniMax-M3")
      expect(result.agents?.atlas?.fallback_models?.[2]?.model).toBe("opencode-go/minimax-m2.7")
    })

    test("uses minimaxi.com MiniMax-M3 when only MiniMax CN Coding Plan is available", () => {
      // given only MiniMax CN Coding Plan is available
      const config = createConfig({ hasMinimaxCnCodingPlan: true })

      // when the generated model config is resolved
      const result = generateModelConfig(config)

      // then utility routes use the regional MiniMax provider
      expect(result.agents?.librarian?.model).toBe("minimax-cn-coding-plan/MiniMax-M3")
      expect(result.agents?.explore?.model).toBe("minimax-cn-coding-plan/MiniMax-M3")
      expect(result.categories?.quick?.model).toBe("minimax-cn-coding-plan/MiniMax-M3")
    })
  })

  test("always includes the canonical schema URL", () => {
    // given the default installation configuration
    const config = createConfig()

    // when the generated model config is resolved
    const result = generateModelConfig(config)

    // then it uses the canonical schema URL
    expect(result.$schema).toBe(
      "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/oh-my-opencode.schema.json"
    )
  })
})

describe("shouldShowChatGPTOnlyWarning", () => {
  test("returns true when OpenAI is the only configured provider", () => {
    // given only OpenAI is configured
    const config = createConfig({ hasOpenAI: true })

    // when the warning policy is evaluated
    const result = shouldShowChatGPTOnlyWarning(config)

    // then the ChatGPT-only warning is shown
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
      // given OpenAI and another provider are configured
      const config = createConfig({ hasOpenAI: true, ...overrides })

      // when the warning policy is evaluated
      const result = shouldShowChatGPTOnlyWarning(config)

      // then the ChatGPT-only warning is hidden
      expect(result).toBe(false)
    })
  }
})
