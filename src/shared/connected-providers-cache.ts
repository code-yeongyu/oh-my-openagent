import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs"
import { join } from "path"
import { log } from "./logger"
import * as dataPath from "./data-path"

const CONNECTED_PROVIDERS_CACHE_FILE = "connected-providers.json"
const PROVIDER_MODELS_CACHE_FILE = "provider-models.json"

interface ConnectedProvidersCache {
	connected: string[]
	updatedAt: string
}

export interface ModelMetadata {
	id: string
	provider?: string
	context?: number
	output?: number
	name?: string
	variants?: Record<string, unknown>
	limit?: {
		context?: number
		input?: number
		output?: number
	}
	modalities?: {
		input?: string[]
		output?: string[]
	}
	capabilities?: Record<string, unknown>
	reasoning?: boolean
	temperature?: boolean
	tool_call?: boolean
	[key: string]: unknown
}

export interface ProviderModelsCache {
	models: Record<string, string[] | ModelMetadata[]>
	connected: string[]
	updatedAt: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null
}

export function createConnectedProvidersCacheStore(
	getCacheDir: () => string = dataPath.getOmoOpenCodeCacheDir
) {
	function getCacheFilePath(filename: string): string {
		return join(getCacheDir(), filename)
	}

	let memConnected: string[] | null | undefined
	let memProviderModels: ProviderModelsCache | null | undefined

	function ensureCacheDir(): void {
		const cacheDir = getCacheDir()
		if (!existsSync(cacheDir)) {
			mkdirSync(cacheDir, { recursive: true })
		}
	}

	function readConnectedProvidersCache(): string[] | null {
		if (memConnected !== undefined) return memConnected
		const cacheFile = getCacheFilePath(CONNECTED_PROVIDERS_CACHE_FILE)

		if (!existsSync(cacheFile)) {
			log("[connected-providers-cache] Cache file not found", { cacheFile })
			memConnected = null
			return null
		}

		try {
			const content = readFileSync(cacheFile, "utf-8")
			const data = JSON.parse(content) as ConnectedProvidersCache
			log("[connected-providers-cache] Read cache", { count: data.connected.length, updatedAt: data.updatedAt })
			memConnected = data.connected
			return data.connected
		} catch (err) {
			log("[connected-providers-cache] Error reading cache", { error: String(err) })
			memConnected = null
			return null
		}
	}

	function hasConnectedProvidersCache(): boolean {
		const cacheFile = getCacheFilePath(CONNECTED_PROVIDERS_CACHE_FILE)
		return existsSync(cacheFile)
	}

	function writeConnectedProvidersCache(connected: string[]): void {
		ensureCacheDir()
		const cacheFile = getCacheFilePath(CONNECTED_PROVIDERS_CACHE_FILE)

		const data: ConnectedProvidersCache = {
			connected,
			updatedAt: new Date().toISOString(),
		}

		try {
			writeFileSync(cacheFile, JSON.stringify(data, null, 2))
			memConnected = connected
			log("[connected-providers-cache] Cache written", { count: connected.length })
		} catch (err) {
			log("[connected-providers-cache] Error writing cache", { error: String(err) })
		}
	}

	function readProviderModelsCache(): ProviderModelsCache | null {
		if (memProviderModels !== undefined) return memProviderModels
		const cacheFile = getCacheFilePath(PROVIDER_MODELS_CACHE_FILE)

		if (!existsSync(cacheFile)) {
			log("[connected-providers-cache] Provider-models cache file not found", { cacheFile })
			memProviderModels = null
			return null
		}

		try {
			const content = readFileSync(cacheFile, "utf-8")
			const data = JSON.parse(content) as ProviderModelsCache
			log("[connected-providers-cache] Read provider-models cache", {
				providerCount: Object.keys(data.models).length,
				updatedAt: data.updatedAt,
			})
			memProviderModels = data
			return data
		} catch (err) {
			log("[connected-providers-cache] Error reading provider-models cache", { error: String(err) })
			memProviderModels = null
			return null
		}
	}

	function hasProviderModelsCache(): boolean {
		const cacheFile = getCacheFilePath(PROVIDER_MODELS_CACHE_FILE)
		return existsSync(cacheFile)
	}

	function writeProviderModelsCache(data: { models: Record<string, string[] | ModelMetadata[]>; connected: string[] }): void {
		ensureCacheDir()
		const cacheFile = getCacheFilePath(PROVIDER_MODELS_CACHE_FILE)

		const cacheData: ProviderModelsCache = {
			...data,
			updatedAt: new Date().toISOString(),
		}

		try {
			writeFileSync(cacheFile, JSON.stringify(cacheData, null, 2))
			memProviderModels = cacheData
			log("[connected-providers-cache] Provider-models cache written", {
				providerCount: Object.keys(data.models).length,
			})
		} catch (err) {
			log("[connected-providers-cache] Error writing provider-models cache", { error: String(err) })
		}
	}

	async function updateConnectedProvidersCache(client: {
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
			log("[connected-providers-cache] Fetched connected providers", {
				count: connected.length,
				providers: connected,
			})

			writeConnectedProvidersCache(connected)

			const modelsByProvider: Record<string, ModelMetadata[]> = {}
			const allProviders = result.data?.all ?? []

			for (const provider of allProviders) {
				if (provider.models) {
					const modelMetadata = Object.entries(provider.models).map(([modelID, rawMetadata]) => {
						if (!isRecord(rawMetadata)) {
							return { id: modelID }
						}

						const normalizedID = typeof rawMetadata.id === "string"
							? rawMetadata.id
							: modelID

						return {
							...rawMetadata,
							id: normalizedID,
						} satisfies ModelMetadata
					})
					if (modelMetadata.length > 0) {
						modelsByProvider[provider.id] = modelMetadata
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

	return {
		readConnectedProvidersCache,
		hasConnectedProvidersCache,
		readProviderModelsCache,
		hasProviderModelsCache,
		writeProviderModelsCache,
		updateConnectedProvidersCache,
	}
}

export function findProviderModelMetadata(
	providerID: string,
	modelID: string,
	cache: ProviderModelsCache | null = defaultConnectedProvidersCacheStore.readProviderModelsCache(),
): ModelMetadata | undefined {
	const providerModels = cache?.models?.[providerID]
	if (!providerModels) {
		return undefined
	}

	for (const entry of providerModels) {
		if (typeof entry === "string") {
			if (entry === modelID) {
				return { id: entry }
			}
			continue
		}

		if (entry?.id === modelID) {
			return entry
		}
	}

	return undefined
}

const defaultConnectedProvidersCacheStore = createConnectedProvidersCacheStore(
	() => dataPath.getOmoOpenCodeCacheDir()
)

export const {
	readConnectedProvidersCache,
	hasConnectedProvidersCache,
	readProviderModelsCache,
	hasProviderModelsCache,
	writeProviderModelsCache,
	updateConnectedProvidersCache,
} = defaultConnectedProvidersCacheStore
