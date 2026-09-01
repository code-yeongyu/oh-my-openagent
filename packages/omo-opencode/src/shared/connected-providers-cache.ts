import { isRecord } from "@oh-my-opencode/utils"
import { log } from "./logger"
import * as dataPath from "./data-path"
import { createJsonFileCacheStore } from "./json-file-cache-store"

// Track if provider models cache has been successfully written in the current process
// This helps in sandbox environments where filesystem state may not persist across contexts
let providerModelsCacheWrittenInCurrentProcess = false

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



function mergeConnectedProviders(
	previous: string[] | null | undefined,
	fetched: string[],
	reportedProviderIDs: Set<string>,
): string[] {
	if (!previous || previous.length === 0) {
		return fetched
	}

	if (fetched.length === 0 && reportedProviderIDs.size === 0) {
		return previous
	}

	const fetchedSet = new Set(fetched)
	const droppedPreviousProvider = previous.some((provider) => !fetchedSet.has(provider))
	if (!droppedPreviousProvider) {
		return fetched
	}

	const fetchedSetWithConfirmedDisconnects = new Set(fetched)
	for (const provider of previous) {
		if (!reportedProviderIDs.has(provider)) {
			fetchedSetWithConfirmedDisconnects.add(provider)
		}
	}
	return Array.from(fetchedSetWithConfirmedDisconnects)
}

function mergeProviderModels(
	previous: Record<string, string[] | ModelMetadata[]> | undefined,
	fetched: Record<string, ModelMetadata[]>,
	connected: string[],
	reportedModelProviderIDs: Set<string>,
): Record<string, string[] | ModelMetadata[]> {
	const merged: Record<string, string[] | ModelMetadata[]> = {}
	for (const provider of connected) {
		if (fetched[provider]) {
			merged[provider] = fetched[provider]
		} else if (reportedModelProviderIDs.has(provider) && previous?.[provider]) {
			merged[provider] = []
		} else if (previous?.[provider]) {
			merged[provider] = previous[provider]
		}
	}
	return merged
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
		// First check if we've written the cache in the current process
		// This handles sandbox environments where filesystem state may not persist across contexts
		if (providerModelsCacheWrittenInCurrentProcess) {
			return true
		}
		// Fall back to the store's has() method (which also checks in-memory state)
		return providerModelsCacheStore.has()
	}

	function writeProviderModelsCache(data: { models: Record<string, string[] | ModelMetadata[]>; connected: string[] }): void {
		providerModelsCacheStore.write({
			...data,
			updatedAt: new Date().toISOString(),
		})
		providerModelsCacheWrittenInCurrentProcess = true
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
			const previousConnected = readConnectedProvidersCache()
			const previousProviderModels = readProviderModelsCache()
			const result = await client.provider.list()
			const fetchedConnected = result.data?.connected ?? []
			const allProviders = result.data?.all ?? []
			const reportedProviderIDs = new Set(allProviders.map((provider) => provider.id))
			const connected = mergeConnectedProviders(previousConnected ?? previousProviderModels?.connected, fetchedConnected, reportedProviderIDs)
			log("[connected-providers-cache] Fetched connected providers", {
				count: fetchedConnected.length,
				providers: fetchedConnected,
			})

			writeConnectedProvidersCache(connected)

			const modelsByProvider: Record<string, ModelMetadata[]> = {}
			const reportedModelProviderIDs = new Set<string>()

			for (const provider of allProviders) {
				if (provider.models) {
					reportedModelProviderIDs.add(provider.id)
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
			const mergedModelsByProvider = mergeProviderModels(previousProviderModels?.models, modelsByProvider, connected, reportedModelProviderIDs)

			log("[connected-providers-cache] Extracted models from provider list", {
				providerCount: Object.keys(mergedModelsByProvider).length,
				totalModels: Object.values(mergedModelsByProvider).reduce((sum, ids) => sum + ids.length, 0),
			})

			writeProviderModelsCache({
				models: mergedModelsByProvider,
				connected,
			})
		} catch (err) {
			log("[connected-providers-cache] Error updating cache", { error: String(err) })
		}
	}

	function _resetMemCacheForTesting(): void {
		connectedProvidersCacheStore.resetMemory()
		providerModelsCacheStore.resetMemory()
		providerModelsCacheWrittenInCurrentProcess = false
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
