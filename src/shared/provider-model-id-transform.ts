function inferSubProvider(model: string): string | undefined {
	if (model.startsWith("claude-")) return "anthropic"
	if (model.startsWith("gpt-")) return "openai"
	if (model.startsWith("gemini-")) return "google"
	if (model.startsWith("grok-")) return "xai"
	return undefined
}

function transformModelForGateway(model: string): string {
	return model
		.replace("claude-opus-4-6", "claude-opus-4.6")
		.replace("claude-sonnet-4-6", "claude-sonnet-4.6")
		.replace("claude-sonnet-4-5", "claude-sonnet-4.5")
		.replace("claude-haiku-4-5", "claude-haiku-4.5")
		.replace(/gemini-3\.1-pro(?!-)/g, "gemini-3.1-pro-preview")
}

export function transformModelForProvider(provider: string, model: string): string {
	if (provider === "vercel") {
		const slashIndex = model.indexOf("/")
		if (slashIndex !== -1) {
			const subProvider = model.substring(0, slashIndex)
			const subModel = model.substring(slashIndex + 1)
			return `${subProvider}/${transformModelForGateway(subModel)}`
		}
		const subProvider = inferSubProvider(model)
		if (subProvider) {
			return `${subProvider}/${transformModelForGateway(model)}`
		}
		return model
	}
	if (provider === "github-copilot") {
		return model
			.replace("claude-opus-4-6", "claude-opus-4.6")
			.replace("claude-sonnet-4-6", "claude-sonnet-4.6")
			.replace("claude-sonnet-4-5", "claude-sonnet-4.5")
			.replace("claude-haiku-4-5", "claude-haiku-4.5")
			.replace("claude-sonnet-4", "claude-sonnet-4")
			.replace(/gemini-3\.1-pro(?!-)/g, "gemini-3.1-pro-preview")
			.replace(/gemini-3-flash(?!-)/g, "gemini-3-flash-preview")
	}
	if (provider === "google") {
		return model
			.replace(/gemini-3\.1-pro(?!-)/g, "gemini-3.1-pro-preview")
			.replace(/gemini-3-flash(?!-)/g, "gemini-3-flash-preview")
	}
	if (provider === "anthropic") {
		return model
			.replace("claude-opus-4-6", "claude-opus-4.6")
			.replace("claude-sonnet-4-6", "claude-sonnet-4.6")
			.replace("claude-haiku-4-5", "claude-haiku-4.5")
	}
	return model
}
