import type { InstallConfig } from "./types"
import type { ProviderAvailability } from "./model-fallback-types"

export function toProviderAvailability(config: InstallConfig): ProviderAvailability {
	return {
		native: {
			claude: config.hasClaude,
			openai: config.hasOpenAI,
			gemini: config.hasGemini,
		},
		opencodeZen: config.hasOpencodeZen,
		copilot: config.hasCopilot,
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
		"github-copilot": availability.copilot,
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
