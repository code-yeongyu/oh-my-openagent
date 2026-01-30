import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs"
import { join } from "path"
import { log } from "./logger"
import { getOmoOpenCodeCacheDir } from "./data-path"

const CONNECTED_PROVIDERS_CACHE_FILE = "connected-providers.json"
const PROVIDER_MODELS_CACHE_FILE = "provider-models.json"

interface ConnectedProvidersCache {
	connected: string[]
	updatedAt: string
}

interface ProviderModelsCache {
	models: Record<string, string[]>
	connected: string[]
	updatedAt: string
}

function getCacheFilePath(filename: string): string {
	return join(getOmoOpenCodeCacheDir(), filename)
}

function ensureCacheDir(): void {
	const cacheDir = getOmoOpenCodeCacheDir()
	if (!existsSync(cacheDir)) {
		mkdirSync(cacheDir, { recursive: true })
	}
}

/**
 * Read the connected providers cache.
 * Returns the list of connected provider IDs, or null if cache doesn't exist.
 */
export function readConnectedProvidersCache(): string[] | null {
	const cacheFile = getCacheFilePath(CONNECTED_PROVIDERS_CACHE_FILE)

	if (!existsSync(cacheFile)) {
		log("[connected-providers-cache] Cache file not found", { cacheFile })
		return null
	}

	try {
		const content = readFileSync(cacheFile, "utf-8")
		const data = JSON.parse(content) as ConnectedProvidersCache
		log("[connected-providers-cache] Read cache", { count: data.connected.length, updatedAt: data.updatedAt })
		return data.connected
	} catch (err) {
		log("[connected-providers-cache] Error reading cache", { error: String(err) })
		return null
	}
}

/**
 * Check if connected providers cache exists.
 */
export function hasConnectedProvidersCache(): boolean {
	const cacheFile = getCacheFilePath(CONNECTED_PROVIDERS_CACHE_FILE)
	return existsSync(cacheFile)
}

/**
 * Write the connected providers cache.
 */
function writeConnectedProvidersCache(connected: string[]): void {
	ensureCacheDir()
	const cacheFile = getCacheFilePath(CONNECTED_PROVIDERS_CACHE_FILE)

	const data: ConnectedProvidersCache = {
		connected,
		updatedAt: new Date().toISOString(),
	}

	try {
		writeFileSync(cacheFile, JSON.stringify(data, null, 2))
		log("[connected-providers-cache] Cache written", { count: connected.length })
	} catch (err) {
		log("[connected-providers-cache] Error writing cache", { error: String(err) })
	}
}

/**
 * Read the provider-models cache.
 * Returns the cache data, or null if cache doesn't exist.
 */
export function readProviderModelsCache(): ProviderModelsCache | null {
	const cacheFile = getCacheFilePath(PROVIDER_MODELS_CACHE_FILE)

	if (!existsSync(cacheFile)) {
		log("[connected-providers-cache] Provider-models cache file not found", { cacheFile })
		return null
	}

	try {
		const content = readFileSync(cacheFile, "utf-8")
		const data = JSON.parse(content) as ProviderModelsCache
		log("[connected-providers-cache] Read provider-models cache", { 
			providerCount: Object.keys(data.models).length, 
			updatedAt: data.updatedAt 
		})
		return data
	} catch (err) {
		log("[connected-providers-cache] Error reading provider-models cache", { error: String(err) })
		return null
	}
}

/**
 * Check if provider-models cache exists.
 */
export function hasProviderModelsCache(): boolean {
	const cacheFile = getCacheFilePath(PROVIDER_MODELS_CACHE_FILE)
	return existsSync(cacheFile)
}

/**
 * Write the provider-models cache.
 */
export function writeProviderModelsCache(data: { models: Record<string, string[]>; connected: string[] }): void {
	ensureCacheDir()
	const cacheFile = getCacheFilePath(PROVIDER_MODELS_CACHE_FILE)

	const cacheData: ProviderModelsCache = {
		...data,
		updatedAt: new Date().toISOString(),
	}

	try {
		writeFileSync(cacheFile, JSON.stringify(cacheData, null, 2))
		log("[connected-providers-cache] Provider-models cache written", { 
			providerCount: Object.keys(data.models).length 
		})
	} catch (err) {
		log("[connected-providers-cache] Error writing provider-models cache", { error: String(err) })
	}
}

/**
 * Update the connected providers cache by fetching from the client.
 * Also updates the provider-models cache with model lists per provider.
 */
export async function updateConnectedProvidersCache(client: {
	provider?: {
		list?: () => Promise<{ data?: { connected?: string[] } }>
	}
	model?: {
		list?: () => Promise<{ data?: Array<{ id: string; provider: string }> }>
	}
}): Promise<void> {
	if (!client?.provider?.list) {
		log("[connected-providers-cache] client.provider.list not available")
		return
	}

	try {
		const result = await client.provider.list()
		const connected = result.data?.connected ?? []
		log("[connected-providers-cache] Fetched connected providers", { count: connected.length, providers: connected })

		writeConnectedProvidersCache(connected)

		// Always update provider-models cache (overwrite with fresh data)
		let modelsByProvider: Record<string, string[]> = {}
		if (client.model?.list) {
			try {
				const modelsResult = await client.model.list()
				const models = modelsResult.data ?? []

				for (const model of models) {
					if (!modelsByProvider[model.provider]) {
						modelsByProvider[model.provider] = []
					}
					modelsByProvider[model.provider].push(model.id)
				}

				log("[connected-providers-cache] Fetched models from API", {
					providerCount: Object.keys(modelsByProvider).length,
					totalModels: models.length,
				})
			} catch (modelErr) {
				log("[connected-providers-cache] Error fetching models, writing empty cache", { error: String(modelErr) })
			}
		} else {
			log("[connected-providers-cache] client.model.list not available, writing empty cache")
		}

		writeProviderModelsCache({
			models: modelsByProvider,
			connected,
		})
	} catch (err) {
		log("[connected-providers-cache] Error updating cache", { error: String(err) })
	}
}
