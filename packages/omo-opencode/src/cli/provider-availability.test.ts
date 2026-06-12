import { describe, expect, test } from "bun:test"

import { ULTIMATE_FALLBACK } from "./model-fallback"
import {
	getNoModelProvidersWarning,
	hasAnyConfiguredProvider,
	isProviderAvailable,
	toProviderAvailability,
} from "./provider-availability"
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

  test("installer warning copy uses ultimate fallback constant", () => {
    expect(getNoModelProvidersWarning()).toBe(
      `No model providers configured. Using ${ULTIMATE_FALLBACK} as fallback.`,
    )
  })

  test("hasAnyConfiguredProvider treats Bailian-only config as configured", () => {
    expect(hasAnyConfiguredProvider(createConfig({ hasBailianCodingPlan: true }))).toBe(true)
    expect(hasAnyConfiguredProvider(createConfig())).toBe(false)
  })
})
