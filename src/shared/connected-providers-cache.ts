import { existsSync } from "fs"
import { join } from "path"
import { log } from "./logger"
import { getOmoOpenCodeCacheDir } from "./data-path"
import { readJsonFile, writeJsonFile } from "./json-cache"

const CONNECTED_PROVIDERS_CACHE_FILE = "connected-providers.json"
const PROVIDER_MODELS_CACHE_FILE = "provider-models.json"

interface ConnectedProvidersCache {
	connected: string[]
	updatedAt: string
}

interface ModelMetadata {
	id: string
	provider?: string
	context?: number
	output?: number
	name?: string
}

interface ProviderModelsCache {
	models: Record<string, string[] | ModelMetadata[]>
	connected: string[]
	updatedAt: string
}

function getCacheFilePath(filename: string): string {
	return join(getOmoOpenCodeCacheDir(), filename)
}



/**
 * Read the connected providers cache.
 * Returns the list of connected provider IDs, or null if cache doesn't exist.
 */
export function readConnectedProvidersCache(): string[] | null {
	const cacheFile = getCacheFilePath(CONNECTED_PROVIDERS_CACHE_FILE)

	const data = readJsonFile<ConnectedProvidersCache>(cacheFile)
	if (!data) {
		log("[connected-providers-cache] Cache file not found", { cacheFile })
		return null
	}

	log("[connected-providers-cache] Read cache", { count: data.connected.length, updatedAt: data.updatedAt })
	return data.connected
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
	const cacheFile = getCacheFilePath(CONNECTED_PROVIDERS_CACHE_FILE)

	const data: ConnectedProvidersCache = {
		connected,
		updatedAt: new Date().toISOString(),
	}

	writeJsonFile(cacheFile, data, { ensureDir: true })
	log("[connected-providers-cache] Cache written", { count: connected.length })
}

/**
 * Read the provider-models cache.
 * Returns the cache data, or null if cache doesn't exist.
 */
export function readProviderModelsCache(): ProviderModelsCache | null {
	const cacheFile = getCacheFilePath(PROVIDER_MODELS_CACHE_FILE)

	const data = readJsonFile<ProviderModelsCache>(cacheFile)
	if (!data) {
		log("[connected-providers-cache] Provider-models cache file not found", { cacheFile })
		return null
	}

	log("[connected-providers-cache] Read provider-models cache", { 
		providerCount: Object.keys(data.models).length, 
		updatedAt: data.updatedAt 
	})
	return data
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
	const cacheFile = getCacheFilePath(PROVIDER_MODELS_CACHE_FILE)

	const cacheData: ProviderModelsCache = {
		...data,
		updatedAt: new Date().toISOString(),
	}

	writeJsonFile(cacheFile, cacheData, { ensureDir: true })
	log("[connected-providers-cache] Provider-models cache written", { 
		providerCount: Object.keys(data.models).length 
	})
}

/**
 * Update the connected providers cache by fetching from the client.
 * Also updates the provider-models cache with model lists per provider.
 */
export async function updateConnectedProvidersCache(client: {
	provider?: {
		list?: () => Promise<{
			data?: {
				connected?: string[]
				all?: Array<{ id: string; models?: Record<string, unknown> }>
			}
		}>
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

		const modelsByProvider: Record<string, string[]> = {}
		const allProviders = result.data?.all ?? []

		for (const provider of allProviders) {
			if (provider.models) {
				const modelIds = Object.keys(provider.models)
				if (modelIds.length > 0) {
					modelsByProvider[provider.id] = modelIds
				}
			}
		}

		log("[connected-providers-cache] Extracted models from provider list", {
			providerCount: Object.keys(modelsByProvider).length,
			totalModels: Object.values(modelsByProvider).reduce((sum, ids) => sum + ids.length, 0),
		})

		writeProviderModelsCache({
			models: modelsByProvider,
			connected,
		})
	} catch (err) {
		log("[connected-providers-cache] Error updating cache", { error: String(err) })
	}
}
