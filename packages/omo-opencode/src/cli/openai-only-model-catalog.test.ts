import { describe, expect, test } from "bun:test"

import { generateModelConfig } from "./model-fallback"
import { isOpenAiOnlyAvailability } from "./openai-only-model-catalog"
import { toProviderAvailability } from "./provider-availability"
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

const mixedProviderCases: Array<{ name: string; overrides: Partial<InstallConfig> }> = [
  { name: "Bailian Coding Plan", overrides: { hasBailianCodingPlan: true } },
  { name: "MiniMax CN Coding Plan", overrides: { hasMinimaxCnCodingPlan: true } },
  { name: "MiniMax Coding Plan", overrides: { hasMinimaxCodingPlan: true } },
  { name: "Vercel AI Gateway", overrides: { hasVercelAiGateway: true } },
]

describe("generateModelConfig OpenAI-only model catalog", () => {
  test("fills remaining OpenAI-only agent gaps with OpenAI models", () => {
    // #given
    const config = createConfig({ hasOpenAI: true })

    // #when
    const result = generateModelConfig(config)

    // #then
    expect(result.agents?.explore).toEqual({ model: "openai/gpt-5.4-mini-fast" })
    expect(result.agents?.librarian).toEqual({ model: "openai/gpt-5.4-mini-fast" })
  })

  test("fills remaining OpenAI-only category gaps with OpenAI models", () => {
    // #given
    const config = createConfig({ hasOpenAI: true })

    // #when
    const result = generateModelConfig(config)

    // #then
    expect(result.categories?.artistry).toEqual({ model: "openai/gpt-5.5", variant: "xhigh" })
    expect(result.categories?.quick).toEqual({ model: "openai/gpt-5.4-mini" })
    expect(result.categories?.["visual-engineering"]).toEqual({ model: "openai/gpt-5.5", variant: "high" })
    expect(result.categories?.writing).toEqual({ model: "openai/gpt-5.5", variant: "medium" })
  })

  test("does not apply OpenAI-only overrides when OpenCode Go is also available", () => {
    // #given
    const config = createConfig({ hasOpenAI: true, hasOpencodeGo: true })

    // #when
    const result = generateModelConfig(config)

    // #then
    expect(result.agents?.explore).toMatchObject({ model: "openai/gpt-5.4-mini-fast" })
    expect(result.agents?.librarian).toMatchObject({ model: "openai/gpt-5.4-mini-fast" })
    expect(result.agents?.explore).not.toMatchObject({ variant: "medium" })
    expect(result.agents?.librarian).not.toMatchObject({ variant: "medium" })
    expect(result.categories?.quick).toMatchObject({ model: "openai/gpt-5.4-mini" })
  })

  for (const { name, overrides } of mixedProviderCases) {
    test(`does not apply OpenAI-only overrides when ${name} is also available`, () => {
      // #given
      const config = createConfig({ hasOpenAI: true, ...overrides })

      // #when
      const availability = toProviderAvailability(config)
      const result = generateModelConfig(config)

      // #then
      expect(isOpenAiOnlyAvailability(availability)).toBe(false)
      expect(result.categories?.writing).not.toEqual({ model: "openai/gpt-5.5", variant: "medium" })
    })
  }
})
