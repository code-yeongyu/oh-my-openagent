import type { InstallConfig } from "./types"
import type { ProviderAvailability } from "./model-fallback-types"
import { createEmptyLocalProviderModels } from "./local-model-capabilities"

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
		lmstudio: config.hasLmstudio,
		ollama: config.hasOllama,
		vllm: config.hasVllm,
		localProviderModels: config.localProviderModels ?? createEmptyLocalProviderModels(),
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
		lmstudio: availability.lmstudio,
		ollama: availability.ollama,
		vllm: availability.vllm,
	}
	return mapping[provider] ?? false
}
