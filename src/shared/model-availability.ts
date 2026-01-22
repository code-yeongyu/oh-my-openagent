/**
 * Fuzzy matching utility for model names
 * Supports substring matching with provider filtering and priority-based selection
 */

import { log } from "./logger"

/**
 * Fuzzy match a target model name against available models
 * 
 * @param target - The model name or substring to search for (e.g., "gpt-5.2", "claude-opus")
 * @param available - Set of available model names in format "provider/model-name"
 * @param providers - Optional array of provider names to filter by (e.g., ["openai", "anthropic"])
 * @returns The matched model name or null if no match found
 * 
 * Matching priority:
 * 1. Exact match (if exists)
 * 2. Shorter model name (more specific)
 * 
 * Matching is case-insensitive substring match.
 * If providers array is given, only models starting with "provider/" are considered.
 * 
 * @example
 * const available = new Set(["openai/gpt-5.2", "openai/gpt-5.2-codex", "anthropic/claude-opus-4-5"])
 * fuzzyMatchModel("gpt-5.2", available) // → "openai/gpt-5.2"
 * fuzzyMatchModel("claude", available, ["openai"]) // → null (provider filter excludes anthropic)
 */
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

	const targetLower = target.toLowerCase()

	// Filter by providers if specified
	let candidates = Array.from(available)
	if (providers && providers.length > 0) {
		const providerSet = new Set(providers)
		candidates = candidates.filter((model) => {
			const [provider] = model.split("/")
			return providerSet.has(provider)
		})
		log("[fuzzyMatchModel] filtered by providers", { candidateCount: candidates.length, candidates: candidates.slice(0, 10) })
	}

	if (candidates.length === 0) {
		log("[fuzzyMatchModel] no candidates after filter")
		return null
	}

	// Find all matches (case-insensitive substring match)
	const matches = candidates.filter((model) =>
		model.toLowerCase().includes(targetLower),
	)

	log("[fuzzyMatchModel] substring matches", { targetLower, matchCount: matches.length, matches })

	if (matches.length === 0) {
		return null
	}

	// Priority 1: Exact match
	const exactMatch = matches.find((model) => model.toLowerCase() === targetLower)
	if (exactMatch) {
		log("[fuzzyMatchModel] exact match found", { exactMatch })
		return exactMatch
	}

	// Priority 2: Shorter model name (more specific)
	const result = matches.reduce((shortest, current) =>
		current.length < shortest.length ? current : shortest,
	)
	log("[fuzzyMatchModel] shortest match", { result })
	return result
}

let cachedModels: Set<string> | null = null

export async function fetchAvailableModels(client: any): Promise<Set<string>> {
	if (cachedModels !== null) {
		log("[fetchAvailableModels] returning cached models", { count: cachedModels.size, models: Array.from(cachedModels).slice(0, 20) })
		return cachedModels
	}

	try {
		const models = await client.model.list()
		const modelSet = new Set<string>()

		log("[fetchAvailableModels] raw response", { isArray: Array.isArray(models), length: Array.isArray(models) ? models.length : 0, sample: Array.isArray(models) ? models.slice(0, 5) : models })

		if (Array.isArray(models)) {
			for (const model of models) {
				if (model.id && typeof model.id === "string") {
					modelSet.add(model.id)
				}
			}
		}

		log("[fetchAvailableModels] parsed models", { count: modelSet.size, models: Array.from(modelSet) })

		cachedModels = modelSet
		return modelSet
	} catch (err) {
		log("[fetchAvailableModels] error", { error: String(err) })
		return new Set<string>()
	}
}

export function __resetModelCache(): void {
	cachedModels = null
}
