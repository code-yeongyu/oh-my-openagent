function inferSubProvider(model: string): string | undefined {
	if (model.startsWith("claude-")) return "anthropic"
	if (model.startsWith("gpt-")) return "openai"
	if (model.startsWith("gemini-")) return "google"
	if (model.startsWith("grok-")) return "xai"
	if (model.startsWith("minimax-")) return "minimax"
	if (model.startsWith("kimi-")) return "moonshotai"
	if (model.startsWith("glm-")) return "zai"
	return undefined
}

const CLAUDE_VERSION_DOT = /claude-(\w+)-(\d+)-(\d+)/g
const GEMINI_31_PRO_PREVIEW = /gemini-3\.1-pro(?!-)/g
const GEMINI_3_FLASH_PREVIEW = /gemini-3-flash(?!-)/g

function claudeVersionDot(model: string): string {
	return model.replace(CLAUDE_VERSION_DOT, "claude-$1-$2.$3")
}

function applyGatewayTransforms(model: string): string {
	return claudeVersionDot(model)
		.replace(GEMINI_31_PRO_PREVIEW, "gemini-3.1-pro-preview")
}

export function transformModelForProvider(provider: string, model: string): string {
	// Vercel AI Gateway expects <sub-provider>/<model> (e.g. anthropic/claude-opus-4.7).
	// Canonical names in model-requirements.ts may be bare (claude-opus-4-7) or
	// already prefixed (anthropic/claude-opus-4-7). Both need gateway-specific transforms.
	if (provider === "vercel") {
		// Already prefixed — transform only the model part
		const slashIndex = model.indexOf("/")
		if (slashIndex !== -1) {
			const subProvider = model.substring(0, slashIndex)
			const subModel = model.substring(slashIndex + 1)
			return `${subProvider}/${applyGatewayTransforms(subModel)}`
		}
		// Bare name — infer sub-provider from model prefix (claude- → anthropic, etc.)
		const subProvider = inferSubProvider(model)
		if (subProvider) {
			return `${subProvider}/${applyGatewayTransforms(model)}`
		}
		return model
	}
	if (provider === "github-copilot") {
		return claudeVersionDot(model)
			.replace(GEMINI_31_PRO_PREVIEW, "gemini-3.1-pro-preview")
			.replace(GEMINI_3_FLASH_PREVIEW, "gemini-3-flash-preview")
	}
	if (provider === "google") {
		return model
			.replace(GEMINI_31_PRO_PREVIEW, "gemini-3.1-pro-preview")
			.replace(GEMINI_3_FLASH_PREVIEW, "gemini-3-flash-preview")
	}
	if (provider === "anthropic") {
		return claudeVersionDot(model)
	}
	return model
}
