function normalizeModelName(name: string): string {
	return name
		.toLowerCase()
		.replace(/claude-(opus|sonnet|haiku)-(\d+)[.-](\d+)/g, "claude-$1-$2.$3")
		.replace(/kimi-k2[.-](\d+)/g, "kimi-k2.$1")
		.replace(/\b(glm|gpt)-(\d+)[.-](\d+)/g, "$1-$2.$3")
}

function modelIdOf(model: string): string {
	return model.split("/").slice(1).join("/")
}

// Tie-break among equally good matches. Provider preference is the caller's `providers` order (a
// chain rung lists its lanes best-first; every match already passed that filter); after that the
// shorter MODEL id is the closer match. The provider name never enters the comparison:
// `opencode/claude-opus-5` must not beat `claude-sdk-oauth/claude-opus-5` just because "opencode"
// is shorter (#8051). Equal candidates keep their `available` order.
function closestMatch(matches: readonly string[], providers: readonly string[] | undefined): string {
	const providerRank = (model: string): number =>
		providers === undefined || providers.length === 0 ? 0 : providers.indexOf(model.split("/")[0] ?? "")
	return matches.reduce((best, current) => {
		const rankDelta = providerRank(current) - providerRank(best)
		if (rankDelta !== 0) return rankDelta < 0 ? current : best
		return modelIdOf(current).length < modelIdOf(best).length ? current : best
	})
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

	const matches = candidates.filter((model) =>
		normalizeModelName(model).includes(targetNormalized),
	)

	if (matches.length === 0) {
		return null
	}

	const exactMatch = matches.find((model) => normalizeModelName(model) === targetNormalized)
	if (exactMatch) {
		return exactMatch
	}

	const exactModelIdMatches = matches.filter(
		(model) => normalizeModelName(modelIdOf(model)) === targetNormalized,
	)
	if (exactModelIdMatches.length > 0) {
		return closestMatch(exactModelIdMatches, providers)
	}

	return closestMatch(matches, providers)
}

export function isModelAvailable(
	targetModel: string,
	availableModels: Set<string>,
): boolean {
	return fuzzyMatchModel(targetModel, availableModels) !== null
}
