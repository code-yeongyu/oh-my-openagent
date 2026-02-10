export function transformModelForProvider(provider: string, model: string): string {
	if (provider === "github-copilot") {
		return model
			.replace("claude-opus-4-6", "claude-opus-4.6")
			.replace("claude-sonnet-4-5", "claude-sonnet-4.5")
			.replace("claude-haiku-4-5", "claude-haiku-4.5")
			.replace("claude-sonnet-4", "claude-sonnet-4")
			.replace("gemini-3-pro", "gemini-3-pro-preview")
			.replace("gemini-3-flash", "gemini-3-flash-preview")
	}
	return model
}
