import { describe, expect, test } from "bun:test"

import { ULTIMATE_FALLBACK } from "./model-fallback"
import {
	getNoModelProvidersWarning,
	hasAnyConfiguredProvider,
	isCopilotModelAllowedForTier,
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
    copilotTier: "no",
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

describe("isCopilotModelAllowedForTier", () => {
  describe("tier: no", () => {
    test("blocks all models when tier is no", () => {
      expect(isCopilotModelAllowedForTier("claude-opus-4.7", "no")).toBe(false)
      expect(isCopilotModelAllowedForTier("claude-sonnet-4.6", "no")).toBe(false)
      expect(isCopilotModelAllowedForTier("gpt-5.4", "no")).toBe(false)
      expect(isCopilotModelAllowedForTier("gpt-5.4-mini", "no")).toBe(false)
      expect(isCopilotModelAllowedForTier("gpt-5-nano", "no")).toBe(false)
      expect(isCopilotModelAllowedForTier("gpt-5.5", "no")).toBe(false)
    })
  })

  describe("tier: student", () => {
    test("blocks Claude Opus", () => {
      expect(isCopilotModelAllowedForTier("claude-opus-4.7", "student")).toBe(false)
    })

    test("blocks Claude Sonnet", () => {
      expect(isCopilotModelAllowedForTier("claude-sonnet-4.6", "student")).toBe(false)
    })

    test("blocks GPT-5.4 (full, not mini)", () => {
      expect(isCopilotModelAllowedForTier("gpt-5.4", "student")).toBe(false)
    })

    test("allows GPT-5.4-mini (mini variant)", () => {
      expect(isCopilotModelAllowedForTier("gpt-5.4-mini", "student")).toBe(true)
    })

    test("allows GPT-5.4-mini-fast (mini variant)", () => {
      expect(isCopilotModelAllowedForTier("gpt-5.4-mini-fast", "student")).toBe(true)
    })

    test("blocks GPT-5.4-nano", () => {
      expect(isCopilotModelAllowedForTier("gpt-5.4-nano", "student")).toBe(false)
    })

    test("blocks GPT-5.5", () => {
      expect(isCopilotModelAllowedForTier("gpt-5.5", "student")).toBe(false)
    })

    test("allows GPT-5-nano", () => {
      expect(isCopilotModelAllowedForTier("gpt-5-nano", "student")).toBe(true)
    })

    test("allows GPT-5-mini", () => {
      expect(isCopilotModelAllowedForTier("gpt-5-mini", "student")).toBe(true)
    })

    test("allows Claude Haiku", () => {
      expect(isCopilotModelAllowedForTier("claude-haiku-4.5", "student")).toBe(true)
    })

    test("allows Gemini models", () => {
      expect(isCopilotModelAllowedForTier("gemini-3-flash-preview", "student")).toBe(true)
      expect(isCopilotModelAllowedForTier("gemini-3.1-pro-preview", "student")).toBe(true)
    })
  })

  describe("tier: pro", () => {
    test("blocks Claude Opus", () => {
      expect(isCopilotModelAllowedForTier("claude-opus-4.7", "pro")).toBe(false)
    })

    test("allows Claude Sonnet", () => {
      expect(isCopilotModelAllowedForTier("claude-sonnet-4.6", "pro")).toBe(true)
    })

    test("allows GPT-5.4 (full)", () => {
      expect(isCopilotModelAllowedForTier("gpt-5.4", "pro")).toBe(true)
    })

    test("allows GPT-5.4-mini", () => {
      expect(isCopilotModelAllowedForTier("gpt-5.4-mini", "pro")).toBe(true)
    })

    test("blocks GPT-5.4-nano", () => {
      expect(isCopilotModelAllowedForTier("gpt-5.4-nano", "pro")).toBe(false)
    })

    test("blocks GPT-5.5", () => {
      expect(isCopilotModelAllowedForTier("gpt-5.5", "pro")).toBe(false)
    })

    test("allows GPT-5-nano", () => {
      expect(isCopilotModelAllowedForTier("gpt-5-nano", "pro")).toBe(true)
    })

    test("allows Claude Haiku", () => {
      expect(isCopilotModelAllowedForTier("claude-haiku-4.5", "pro")).toBe(true)
    })
  })

  describe("tier: pro-plus", () => {
    test("allows all models", () => {
      expect(isCopilotModelAllowedForTier("claude-opus-4.7", "pro-plus")).toBe(true)
      expect(isCopilotModelAllowedForTier("claude-sonnet-4.6", "pro-plus")).toBe(true)
      expect(isCopilotModelAllowedForTier("gpt-5.4", "pro-plus")).toBe(true)
      expect(isCopilotModelAllowedForTier("gpt-5.4-mini", "pro-plus")).toBe(true)
      expect(isCopilotModelAllowedForTier("gpt-5.4-nano", "pro-plus")).toBe(true)
      expect(isCopilotModelAllowedForTier("gpt-5.5", "pro-plus")).toBe(true)
      expect(isCopilotModelAllowedForTier("gpt-5-nano", "pro-plus")).toBe(true)
      expect(isCopilotModelAllowedForTier("claude-haiku-4.5", "pro-plus")).toBe(true)
      expect(isCopilotModelAllowedForTier("gemini-3.1-pro-preview", "pro-plus")).toBe(true)
    })
  })
})
