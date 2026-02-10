import { log } from "./logger"

function normalizeModelName(name: string): string {
	return name
		.toLowerCase()
		.replace(/claude-(opus|sonnet|haiku)-4-5/g, "claude-$1-4.5")
		.replace(/claude-(opus|sonnet|haiku)-4\.5/g, "claude-$1-4.5")
}

export function fuzzyMatchModel(
	target: string,
	available: Set<string>,
	providers?: string[],
): string | null {
	log("[fuzzyMatchModel] called", { target, availableCount: available.size, providers })

	if (available.size === 0) {
		log("[fuzzyMatchModel] empty available set")
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
		log("[fuzzyMatchModel] filtered by providers", {
			candidateCount: candidates.length,
			candidates: candidates.slice(0, 10),
		})
	}

	if (candidates.length === 0) {
		log("[fuzzyMatchModel] no candidates after filter")
		return null
	}

	const matches = candidates.filter((model) =>
		normalizeModelName(model).includes(targetNormalized),
	)

	log("[fuzzyMatchModel] substring matches", {
		targetNormalized,
		matchCount: matches.length,
		matches,
	})

	if (matches.length === 0) {
		return null
	}

	const exactMatch = matches.find(
		(model) => normalizeModelName(model) === targetNormalized,
	)
	if (exactMatch) {
		log("[fuzzyMatchModel] exact match found", { exactMatch })
		return exactMatch
	}

	const exactModelIdMatches = matches.filter((model) => {
		const modelId = model.split("/").slice(1).join("/")
		return normalizeModelName(modelId) === targetNormalized
	})
	if (exactModelIdMatches.length > 0) {
		const result = exactModelIdMatches.reduce((shortest, current) =>
			current.length < shortest.length ? current : shortest,
		)
		log("[fuzzyMatchModel] exact model ID match found", {
			result,
			candidateCount: exactModelIdMatches.length,
		})
		return result
	}

	const result = matches.reduce((shortest, current) =>
		current.length < shortest.length ? current : shortest,
	)
	log("[fuzzyMatchModel] shortest match", { result })
	return result
}

export function isModelAvailable(
	targetModel: string,
	availableModels: Set<string>,
): boolean {
	return fuzzyMatchModel(targetModel, availableModels) !== null
}
