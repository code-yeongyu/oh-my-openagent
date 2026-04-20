/// <reference types="bun-types" />

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
		hasVercelAiGateway: false,
		...overrides,
	}
}

function collectUnsupportedCopilotVariants(value: unknown): string[] {
	if (!value || typeof value !== "object") {
		return []
	}

	if (Array.isArray(value)) {
		return value.flatMap((entry) => collectUnsupportedCopilotVariants(entry))
	}

	const record = value as Record<string, unknown>
	const model = typeof record.model === "string" ? record.model : undefined
	const variant = typeof record.variant === "string" ? record.variant : undefined
	const currentMatch =
		model?.startsWith("github-copilot/") && (variant === "max" || variant === "xhigh")
			? [`${model}:${variant}`]
			: []

	return Object.values(record).reduce<string[]>((matches, entry) => {
		matches.push(...collectUnsupportedCopilotVariants(entry))
		return matches
	}, currentMatch)
}

describe("generateModelConfig Copilot variants", () => {
	test("downgrades unsupported Copilot max-class variants when only Copilot is available", () => {
		const result = generateModelConfig(createConfig({ hasCopilot: true }))

		expect(result.agents?.sisyphus).toEqual({
			model: "github-copilot/claude-opus-4.7",
			variant: "high",
			fallback_models: [{ model: "github-copilot/gpt-5.5", variant: "medium" }],
		})
		expect(result.agents?.momus).toEqual({
			model: "github-copilot/gpt-5.5",
			variant: "high",
			fallback_models: [
				{ model: "github-copilot/claude-opus-4.7", variant: "high" },
				{ model: "github-copilot/gemini-3.1-pro-preview", variant: "high" },
			],
		})
		expect(result.categories?.["unspecified-high"]).toEqual({
			model: "github-copilot/claude-sonnet-4.6",
			fallback_models: [{ model: "github-copilot/gemini-3-flash-preview" }],
		})
		expect(collectUnsupportedCopilotVariants(result)).toEqual([])
	})

	test("keeps Copilot variants capped even when max plan is selected", () => {
		const result = generateModelConfig(createConfig({ hasCopilot: true, isMax20: true }))

		expect(result.categories?.["unspecified-high"]).toEqual({
			model: "github-copilot/claude-opus-4.7",
			variant: "high",
			fallback_models: [{ model: "github-copilot/gpt-5.5", variant: "high" }],
		})
		expect(collectUnsupportedCopilotVariants(result)).toEqual([])
	})
})
