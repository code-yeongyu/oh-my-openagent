function normalizeModelName(name: string): string {
	return name
		.toLowerCase()
		.replace(/claude-(opus|sonnet|haiku)-(\d+)[.-](\d+)/g, "claude-$1-$2.$3")
		.replace(/kimi-k2[.-](\d+)/g, "kimi-k2.$1")
		.replace(/\b(glm|gpt)-(\d+)[.-](\d+)/g, "$1-$2.$3")
}

function isGemini36FlashPreviewMismatch(target: string, candidate: string): boolean {
	const targetModelID = target.split("/").at(-1) ?? target
	const candidateModelID = candidate.split("/").at(-1) ?? candidate
	return targetModelID === "gemini-3.6-flash" && candidateModelID === "gemini-3.6-flash-preview"
}

export function fuzzyMatchModel(
	target: string,
	available: Set<string>,
	providers?: string[],
): string | null {
	if (available.size === 0) {
		return null
	}

	const targetNormalized = normalizeModelName(target)

	let candidates = Array.from(available)
	if (providers && providers.length > 0) {
		const providerSet = new Set(providers)
		candidates = candidates.filter((model) => {
			const [provider] = model.split("/")
			return providerSet.has(provider)
		})
	}

	if (candidates.length === 0) {
		return null
	}

	const matches = candidates.filter((model) => {
		const normalizedModel = normalizeModelName(model)
		return (
			normalizedModel.includes(targetNormalized) &&
			!isGemini36FlashPreviewMismatch(targetNormalized, normalizedModel)
		)
	})

	if (matches.length === 0) {
		return null
	}

	const exactMatch = matches.find((model) => normalizeModelName(model) === targetNormalized)
	if (exactMatch) {
		return exactMatch
	}

	const exactModelIdMatches = matches.filter((model) => {
		const modelId = model.split("/").slice(1).join("/")
		return normalizeModelName(modelId) === targetNormalized
	})
	if (exactModelIdMatches.length > 0) {
		return exactModelIdMatches.reduce((shortest, current) =>
			current.length < shortest.length ? current : shortest,
		)
	}

	return matches.reduce((shortest, current) =>
		current.length < shortest.length ? current : shortest,
	)
}

export function isModelAvailable(
	targetModel: string,
	availableModels: Set<string>,
): boolean {
	return fuzzyMatchModel(targetModel, availableModels) !== null
}
