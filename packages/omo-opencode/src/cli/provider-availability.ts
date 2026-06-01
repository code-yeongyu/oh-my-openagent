import type { InstallConfig, CopilotSubscription } from "./types"
import type { ProviderAvailability } from "./model-fallback-types"
import { ULTIMATE_FALLBACK } from "./model-fallback"

export function toProviderAvailability(config: InstallConfig): ProviderAvailability {
	return {
		native: {
			claude: config.hasClaude,
			openai: config.hasOpenAI,
			gemini: config.hasGemini,
		},
		opencodeZen: config.hasOpencodeZen,
		copilot: config.copilotTier,
		zai: config.hasZaiCodingPlan,
		kimiForCoding: config.hasKimiForCoding,
		opencodeGo: config.hasOpencodeGo,
		bailianCodingPlan: config.hasBailianCodingPlan,
		minimaxCnCodingPlan: config.hasMinimaxCnCodingPlan,
		minimaxCodingPlan: config.hasMinimaxCodingPlan,
		vercelAiGateway: config.hasVercelAiGateway,
		isMaxPlan: config.isMax20,
	}
}

export function isProviderAvailable(provider: string, availability: ProviderAvailability): boolean {
	const mapping: Record<string, boolean> = {
		anthropic: availability.native.claude,
		openai: availability.native.openai,
		google: availability.native.gemini,
		"github-copilot": availability.copilot !== "no",
		opencode: availability.opencodeZen,
		"zai-coding-plan": availability.zai,
		"kimi-for-coding": availability.kimiForCoding,
		"opencode-go": availability.opencodeGo,
		"bailian-coding-plan": availability.bailianCodingPlan,
		"minimax-cn-coding-plan": availability.minimaxCnCodingPlan,
		"minimax-coding-plan": availability.minimaxCodingPlan,
		vercel: availability.vercelAiGateway,
	}
	return mapping[provider] ?? false
}

export function hasAnyConfiguredProvider(config: InstallConfig): boolean {
	const availability = toProviderAvailability(config)
	return (
		availability.native.claude ||
		availability.native.openai ||
		availability.native.gemini ||
		availability.copilot !== "no" ||
		availability.opencodeZen ||
		availability.zai ||
		availability.kimiForCoding ||
		availability.opencodeGo ||
		availability.bailianCodingPlan ||
		availability.minimaxCnCodingPlan ||
		availability.minimaxCodingPlan ||
		availability.vercelAiGateway
	)
}

export function getNoModelProvidersWarning(): string {
	return `No model providers configured. Using ${ULTIMATE_FALLBACK} as fallback.`
}

export function isCopilotModelAllowedForTier(model: string, tier: CopilotSubscription): boolean {
	if (tier === "no") return false
	if (tier === "pro-plus") return true

	const isOpus = model.includes("claude-opus")
	const isGpt55 = model.includes("gpt-5.5")
	const isGpt54Nano = model.includes("gpt-5.4") && model.includes("nano")

	if (tier === "student") {
		const isSonnet = model.includes("claude-sonnet")
		const isGpt54 = model.includes("gpt-5.4") && !model.includes("mini")
		return !isOpus && !isSonnet && !isGpt54 && !isGpt55 && !isGpt54Nano
	}

	// tier === "pro" ($10/mo): full catalog minus premium-only models
	return !isOpus && !isGpt55 && !isGpt54Nano
}
