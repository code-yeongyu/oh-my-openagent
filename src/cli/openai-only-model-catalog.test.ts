import { describe, expect, test } from "bun:test"

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

describe("generateModelConfig OpenAI-only model catalog", () => {
  test("fills remaining OpenAI-only agent gaps with OpenAI models", () => {
    // #given
    const config = createConfig({ hasOpenAI: true })

    // #when
    const result = generateModelConfig(config)

    // #then
    expect(result.agents?.explore).toEqual({ model: "openai/gpt-5.4", variant: "medium" })
    expect(result.agents?.librarian).toEqual({ model: "openai/gpt-5.4", variant: "medium" })
  })

  test("fills remaining OpenAI-only category gaps with OpenAI models", () => {
    // #given
    const config = createConfig({ hasOpenAI: true })

    // #when
    const result = generateModelConfig(config)

    // #then
    expect(result.categories?.artistry).toEqual({ model: "openai/gpt-5.4", variant: "xhigh" })
    expect(result.categories?.quick).toEqual({ model: "openai/gpt-5.4-mini" })
    expect(result.categories?.["visual-engineering"]).toEqual({ model: "openai/gpt-5.4", variant: "high" })
    expect(result.categories?.writing).toEqual({ model: "openai/gpt-5.4", variant: "medium" })
  })

  test("does not apply OpenAI-only overrides when OpenCode Go is also available", () => {
    // #given
    const config = createConfig({ hasOpenAI: true, hasOpencodeGo: true })

    // #when
    const result = generateModelConfig(config)

    // #then
    expect(result.agents?.explore).toEqual({ model: "opencode-go/minimax-m2.5" })
    expect(result.agents?.librarian).toEqual({ model: "opencode-go/minimax-m2.5" })
    expect(result.categories?.quick).toEqual({ model: "openai/gpt-5.4-mini" })
  })
})
