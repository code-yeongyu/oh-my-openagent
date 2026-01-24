/**
 * Fuzzy matching utility for model names
 * Supports substring matching with provider filtering and priority-based selection
 */

import { existsSync, readFileSync } from "fs"
import { homedir } from "os"
import { join } from "path"
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

	// Find all matches (case-insensitive substring match with normalization)
	const matches = candidates.filter((model) =>
		normalizeModelName(model).includes(targetNormalized),
	)

	log("[fuzzyMatchModel] substring matches", { targetNormalized, matchCount: matches.length, matches })

	if (matches.length === 0) {
		return null
	}

	// Priority 1: Exact match (normalized)
	const exactMatch = matches.find((model) => normalizeModelName(model) === targetNormalized)
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

function getOpenCodeCacheDir(): string {
	const xdgCache = process.env.XDG_CACHE_HOME
	if (xdgCache) return join(xdgCache, "opencode")
	return join(homedir(), ".cache", "opencode")
}

export async function fetchAvailableModels(_client?: any): Promise<Set<string>> {
	log("[fetchAvailableModels] CALLED")
	
	if (cachedModels !== null) {
		log("[fetchAvailableModels] returning cached models", { count: cachedModels.size, models: Array.from(cachedModels).slice(0, 20) })
		return cachedModels
	}

	const modelSet = new Set<string>()
	const cacheFile = join(getOpenCodeCacheDir(), "models.json")

	log("[fetchAvailableModels] reading cache file", { cacheFile })

	if (!existsSync(cacheFile)) {
		log("[fetchAvailableModels] cache file not found, returning empty set")
		return modelSet
	}

	try {
		const content = readFileSync(cacheFile, "utf-8")
		const data = JSON.parse(content) as Record<string, { id?: string; models?: Record<string, { id?: string }> }>

		const providerIds = Object.keys(data)
		log("[fetchAvailableModels] providers found", { count: providerIds.length, providers: providerIds.slice(0, 10) })

		for (const providerId of providerIds) {
			const provider = data[providerId]
			const models = provider?.models
			if (!models || typeof models !== "object") continue

			for (const modelKey of Object.keys(models)) {
				modelSet.add(`${providerId}/${modelKey}`)
			}
		}

		log("[fetchAvailableModels] parsed models", { count: modelSet.size, models: Array.from(modelSet).slice(0, 20) })

		cachedModels = modelSet
		return modelSet
	} catch (err) {
		log("[fetchAvailableModels] error", { error: String(err) })
		return modelSet
	}
}

export function __resetModelCache(): void {
	cachedModels = null
}

export function isModelCacheAvailable(): boolean {
	const cacheFile = join(getOpenCodeCacheDir(), "models.json")
	return existsSync(cacheFile)
}
