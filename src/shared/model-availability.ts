import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { log } from "./logger"
import { getOpenCodeCacheDir } from "./data-path"
import { readProviderModelsCache, hasProviderModelsCache } from "./connected-providers-cache"

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

export async function getConnectedProviders(client: any): Promise<string[]> {
	if (!client?.provider?.list) {
		log("[getConnectedProviders] client.provider.list not available")
		return []
	}

	try {
		const result = await client.provider.list()
		const connected = result.data?.connected ?? []
		log("[getConnectedProviders] connected providers", { count: connected.length, providers: connected })
		return connected
	} catch (err) {
		log("[getConnectedProviders] SDK error", { error: String(err) })
		return []
	}
}

export async function fetchAvailableModels(
	_client?: any,
	options?: { connectedProviders?: string[] | null }
): Promise<Set<string>> {
	const connectedProvidersUnknown = options?.connectedProviders === null || options?.connectedProviders === undefined

	log("[fetchAvailableModels] CALLED", { 
		connectedProvidersUnknown,
		connectedProviders: options?.connectedProviders 
	})

	if (connectedProvidersUnknown) {
		log("[fetchAvailableModels] connected providers unknown, returning empty set for fallback resolution")
		return new Set<string>()
	}

	const connectedProviders = options!.connectedProviders!
	const connectedSet = new Set(connectedProviders)
	const modelSet = new Set<string>()

	const providerModelsCache = readProviderModelsCache()
	if (providerModelsCache) {
		log("[fetchAvailableModels] using provider-models cache (whitelist-filtered)")
		
		for (const [providerId, modelIds] of Object.entries(providerModelsCache.models)) {
			if (!connectedSet.has(providerId)) {
				continue
			}
			for (const modelId of modelIds) {
				modelSet.add(`${providerId}/${modelId}`)
			}
		}

		log("[fetchAvailableModels] parsed from provider-models cache", {
			count: modelSet.size,
			connectedProviders: connectedProviders.slice(0, 5)
		})

		return modelSet
	}

	log("[fetchAvailableModels] provider-models cache not found, falling back to models.json")
	const cacheFile = join(getOpenCodeCacheDir(), "models.json")

	if (!existsSync(cacheFile)) {
		log("[fetchAvailableModels] models.json cache file not found, returning empty set")
		return modelSet
	}

	try {
		const content = readFileSync(cacheFile, "utf-8")
		const data = JSON.parse(content) as Record<string, { id?: string; models?: Record<string, { id?: string }> }>

		const providerIds = Object.keys(data)
		log("[fetchAvailableModels] providers found in models.json", { count: providerIds.length, providers: providerIds.slice(0, 10) })

		for (const providerId of providerIds) {
			if (!connectedSet.has(providerId)) {
				continue
			}

			const provider = data[providerId]
			const models = provider?.models
			if (!models || typeof models !== "object") continue

			for (const modelKey of Object.keys(models)) {
				modelSet.add(`${providerId}/${modelKey}`)
			}
		}

		log("[fetchAvailableModels] parsed models from models.json (NO whitelist filtering)", {
			count: modelSet.size,
			connectedProviders: connectedProviders.slice(0, 5)
		})

		return modelSet
	} catch (err) {
		log("[fetchAvailableModels] error", { error: String(err) })
		return modelSet
	}
}

export function __resetModelCache(): void {}

export function isModelCacheAvailable(): boolean {
	if (hasProviderModelsCache()) {
		return true
	}
	const cacheFile = join(getOpenCodeCacheDir(), "models.json")
	return existsSync(cacheFile)
}
