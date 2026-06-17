import { SUPPORTED_PROVIDERS } from "./registry"

function inferSubProvider(model: string): string | undefined {
	if (model.startsWith("claude-")) return SUPPORTED_PROVIDERS.ANTHROPIC
	if (model.startsWith("gpt-")) return SUPPORTED_PROVIDERS.OPENAI
	if (model.startsWith("gemini-")) return SUPPORTED_PROVIDERS.GOOGLE
	if (model.startsWith("grok-")) return SUPPORTED_PROVIDERS.XAI
	if (model.startsWith("minimax-")) return SUPPORTED_PROVIDERS.MINIMAX
	if (model.startsWith("kimi-")) return SUPPORTED_PROVIDERS.MOONSHOTAI
	if (model.startsWith("glm-")) return SUPPORTED_PROVIDERS.ZAI
	return undefined
}

const CLAUDE_VERSION_DOT = /claude-(\w+)-(\d+)-(\d+)/g
const GEMINI_31_PRO_PREVIEW = /gemini-3\.1-pro(?!-)/g
const GEMINI_3_FLASH_PREVIEW = /gemini-3-flash(?!-)/g

function claudeVersionDot(model: string): string {
	return model.replace(CLAUDE_VERSION_DOT, "claude-$1-$2.$3")
}

function applyGatewayTransforms(model: string): string {
	return claudeVersionDot(model).replace(
		GEMINI_31_PRO_PREVIEW,
		"gemini-3.1-pro-preview",
	)
}

function transformModelForProviderUsingAnthropicBehavior(
	provider: string,
	model: string,
): string {
	if (provider === SUPPORTED_PROVIDERS.VERCEL) {
		const slashIndex = model.indexOf("/")
		if (slashIndex !== -1) {
			const subProvider = model.substring(0, slashIndex)
			const subModel = model.substring(slashIndex + 1)
			return `${subProvider}/${applyGatewayTransforms(subModel)}`
		}
		const subProvider = inferSubProvider(model)
		if (subProvider) {
			return `${subProvider}/${applyGatewayTransforms(model)}`
		}
		return model
	}
	if (provider === SUPPORTED_PROVIDERS.GITHUB_COPILOT) {
		return claudeVersionDot(model)
			.replace(GEMINI_31_PRO_PREVIEW, "gemini-3.1-pro-preview")
			.replace(GEMINI_3_FLASH_PREVIEW, "gemini-3-flash-preview")
	}
	if (provider === SUPPORTED_PROVIDERS.GOOGLE) {
		return model
			.replace(GEMINI_31_PRO_PREVIEW, "gemini-3.1-pro-preview")
			.replace(GEMINI_3_FLASH_PREVIEW, "gemini-3-flash-preview")
	}
	if (provider === SUPPORTED_PROVIDERS.ANTHROPIC) {
		return model
	}
	return model
}

export function transformModelForProvider(provider: string, model: string): string {
	return transformModelForProviderUsingAnthropicBehavior(provider, model)
}

export function transformModelForProviderDisplay(
	provider: string,
	model: string,
): string {
	return transformModelForProviderUsingAnthropicBehavior(provider, model)
}
