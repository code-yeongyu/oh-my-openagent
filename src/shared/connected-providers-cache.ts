import { log } from "./logger"
import * as dataPath from "./data-path"
import { createJsonFileCacheStore } from "./json-file-cache-store"

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
	const connectedProvidersCacheStore = createJsonFileCacheStore<ConnectedProvidersCache>({
		getCacheDir,
		filename: CONNECTED_PROVIDERS_CACHE_FILE,
		logPrefix: "connected-providers-cache",
		cacheLabel: "Cache",
		describe: (value) => ({ count: value.connected.length, updatedAt: value.updatedAt }),
	})
	const providerModelsCacheStore = createJsonFileCacheStore<ProviderModelsCache>({
		getCacheDir,
		filename: PROVIDER_MODELS_CACHE_FILE,
		logPrefix: "connected-providers-cache",
		cacheLabel: "Provider-models cache",
		describe: (value) => ({
			providerCount: Object.keys(value.models).length,
			updatedAt: value.updatedAt,
		}),
	})

	function readConnectedProvidersCache(): string[] | null {
		return connectedProvidersCacheStore.read()?.connected ?? null
	}

	function hasConnectedProvidersCache(): boolean {
		return connectedProvidersCacheStore.has()
	}

	function writeConnectedProvidersCache(connected: string[]): void {
		connectedProvidersCacheStore.write({
			connected,
			updatedAt: new Date().toISOString(),
		})
	}

	function readProviderModelsCache(): ProviderModelsCache | null {
		return providerModelsCacheStore.read()
	}

	function hasProviderModelsCache(): boolean {
		return providerModelsCacheStore.has()
	}

	function writeProviderModelsCache(data: { models: Record<string, string[] | ModelMetadata[]>; connected: string[] }): void {
		providerModelsCacheStore.write({
			...data,
			updatedAt: new Date().toISOString(),
		})
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

	function _resetMemCacheForTesting(): void {
		connectedProvidersCacheStore.resetMemory()
		providerModelsCacheStore.resetMemory()
	}

	return {
		readConnectedProvidersCache,
		hasConnectedProvidersCache,
		readProviderModelsCache,
		hasProviderModelsCache,
		writeProviderModelsCache,
		updateConnectedProvidersCache,
		_resetMemCacheForTesting,
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

		if (entry.id === modelID) {
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
	_resetMemCacheForTesting,
} = defaultConnectedProvidersCacheStore
