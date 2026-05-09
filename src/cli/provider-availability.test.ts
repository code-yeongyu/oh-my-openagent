import { describe, expect, test } from "bun:test"
import { isProviderAvailable, toProviderAvailability } from "./provider-availability"
import type { InstallConfig } from "./types"

function baseConfig(overrides: Partial<InstallConfig> = {}): InstallConfig {
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
    hasVercelAiGateway: false,
    ...overrides,
  }
}

describe("toProviderAvailability", () => {
  test("maps hasDeepSeek=true to deepseek=true", () => {
    const availability = toProviderAvailability(baseConfig({ hasDeepSeek: true }))
    expect(availability.deepseek).toBe(true)
  })

  test("maps hasDeepSeek=false to deepseek=false", () => {
    const availability = toProviderAvailability(baseConfig({ hasDeepSeek: false }))
    expect(availability.deepseek).toBe(false)
  })

  test("maps absent hasDeepSeek to deepseek=false (back-compat for legacy InstallConfig)", () => {
    const availability = toProviderAvailability(baseConfig())
    expect(availability.deepseek).toBe(false)
  })
})

describe("isProviderAvailable for deepseek", () => {
  test("returns true when availability.deepseek=true", () => {
    const availability = toProviderAvailability(baseConfig({ hasDeepSeek: true }))
    expect(isProviderAvailable("deepseek", availability)).toBe(true)
  })

  test("returns false when availability.deepseek=false", () => {
    const availability = toProviderAvailability(baseConfig({ hasDeepSeek: false }))
    expect(isProviderAvailable("deepseek", availability)).toBe(false)
  })

  test("returns false for legacy availability without the deepseek field", () => {
    const legacy = { native: { claude: false, openai: false, gemini: false }, opencodeZen: false, copilot: false, zai: false, kimiForCoding: false, opencodeGo: false, vercelAiGateway: false, isMaxPlan: false }
    expect(isProviderAvailable("deepseek", legacy as Parameters<typeof isProviderAvailable>[1])).toBe(false)
  })

  test("does not affect other providers when hasDeepSeek toggles", () => {
    const a = toProviderAvailability(baseConfig({ hasDeepSeek: true, hasOpenAI: true }))
    expect(isProviderAvailable("openai", a)).toBe(true)
    expect(isProviderAvailable("anthropic", a)).toBe(false)
  })
})
