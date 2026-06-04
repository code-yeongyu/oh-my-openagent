import { describe, expect, test } from "bun:test"

import { isProviderAvailable, toProviderAvailability } from "./provider-availability"
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

describe("provider availability", () => {
  test("maps Bailian Coding Plan install flag to provider ID", () => {
    // #given
    const availability = toProviderAvailability(createConfig({ hasBailianCodingPlan: true }))

    // #when / #then
    expect(isProviderAvailable("bailian-coding-plan", availability)).toBe(true)
    expect(isProviderAvailable("minimax-coding-plan", availability)).toBe(false)
  })
})
