import { describe, expect, test } from "bun:test"

import { generateModelConfig } from "./model-fallback"
import type { InstallConfig } from "./types"

// writing is written only when one of its Claude chain providers is available; otherwise the installer
// leaves the lane out instead of pinning it to another family or the opencode/gpt-5-nano last resort.

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

describe("installer writing category", () => {
  test("#given Claude #then writing is written on its Fable rung", () => {
    expect(generateModelConfig(createConfig({ hasClaude: true })).categories?.writing).toMatchObject({
      model: "anthropic/claude-fable-5-1",
    })
  })

  test("#given providers that serve none of writing's models #then writing is omitted", () => {
    const result = generateModelConfig(createConfig({ hasKimiForCoding: true }))

    expect(result.categories?.writing).toBeUndefined()
    expect(result.categories?.quick).toBeDefined()
  })

  test("#given OpenAI only #then writing is omitted", () => {
    expect(generateModelConfig(createConfig({ hasOpenAI: true })).categories?.writing).toBeUndefined()
  })

  test("#given no provider at all #then writing is omitted while other lanes keep the last-resort model", () => {
    const result = generateModelConfig(createConfig())

    expect(result.categories?.writing).toBeUndefined()
    expect(result.categories?.quick).toEqual({ model: "opencode/gpt-5-nano" })
  })
})
