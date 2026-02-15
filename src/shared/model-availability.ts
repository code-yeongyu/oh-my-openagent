import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { log } from "./logger"
import { getOpenCodeCacheDir } from "./data-path"
import * as connectedProvidersCache from "./connected-providers-cache"
import { fuzzyMatchModel } from "./model-name-matcher"

export { fuzzyMatchModel, normalizeModelName } from "./model-name-matcher"

/**
 * Check if a target model is available (fuzzy match by model name, no provider filtering)
 * 
 * @param targetModel - Model name to check (e.g., "gpt-5.3-codex")
 * @param availableModels - Set of available models in "provider/model" format
 * @returns true if model is available, false otherwise
 */
export function isModelAvailable(
	targetModel: string,
	availableModels: Set<string>,
): boolean {
	return fuzzyMatchModel(targetModel, availableModels) !== null
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
	client?: any,
	options?: { connectedProviders?: string[] | null }
): Promise<Set<string>> {
	let connectedProviders = options?.connectedProviders ?? null
	let connectedProvidersUnknown = connectedProviders === null

	log("[fetchAvailableModels] CALLED", { 
		connectedProvidersUnknown,
		connectedProviders: options?.connectedProviders 
	})

	if (connectedProvidersUnknown && client) {
		const liveConnected = await getConnectedProviders(client)
		if (liveConnected.length > 0) {
			connectedProviders = liveConnected
			connectedProvidersUnknown = false
			log("[fetchAvailableModels] connected providers fetched from client", { count: liveConnected.length })
		}
	}

	if (connectedProvidersUnknown) {
		if (client?.model?.list) {
			const modelSet = new Set<string>()
			try {
				const modelsResult = await client.model.list()
				const models = modelsResult.data ?? []
				for (const model of models) {
					if (model?.provider && model?.id) {
						modelSet.add(`${model.provider}/${model.id}`)
					}
				}
				log("[fetchAvailableModels] fetched models from client without provider filter", {
					count: modelSet.size,
				})
				return modelSet
			} catch (err) {
				log("[fetchAvailableModels] client.model.list error", { error: String(err) })
			}
		}
		log("[fetchAvailableModels] connected providers unknown, returning empty set for fallback resolution")
		return new Set<string>()
	}

	const connectedProvidersList = connectedProviders ?? []
	const connectedSet = new Set(connectedProvidersList)
	const modelSet = new Set<string>()

	const providerModelsCache = connectedProvidersCache.readProviderModelsCache()
	if (providerModelsCache) {
		const providerCount = Object.keys(providerModelsCache.models).length
		if (providerCount === 0) {
			log("[fetchAvailableModels] provider-models cache empty, falling back to models.json")
		} else {
		log("[fetchAvailableModels] using provider-models cache (whitelist-filtered)")
		
		const modelsByProvider = providerModelsCache.models as Record<string, Array<string | { id?: string }>>
		for (const [providerId, modelIds] of Object.entries(modelsByProvider)) {
			if (!connectedSet.has(providerId)) {
				continue
			}
			for (const modelItem of modelIds) {
				// Handle both string[] (legacy) and object[] (with metadata) formats
				const modelId = typeof modelItem === 'string' 
					? modelItem 
					: (modelItem as any)?.id
				
				if (modelId) {
					modelSet.add(`${providerId}/${modelId}`)
				}
			}
		}

			log("[fetchAvailableModels] parsed from provider-models cache", {
				count: modelSet.size,
				connectedProviders: connectedProvidersList.slice(0, 5)
			})

			if (modelSet.size > 0) {
				return modelSet
			}
			log("[fetchAvailableModels] provider-models cache produced no models for connected providers, falling back to models.json")
		}
	}

	log("[fetchAvailableModels] provider-models cache not found, falling back to models.json")
	const cacheFile = join(getOpenCodeCacheDir(), "models.json")

	if (!existsSync(cacheFile)) {
		log("[fetchAvailableModels] models.json cache file not found, falling back to client")
	} else {
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
				connectedProviders: connectedProvidersList.slice(0, 5)
			})

			if (modelSet.size > 0) {
				return modelSet
			}
		} catch (err) {
			log("[fetchAvailableModels] error", { error: String(err) })
		}
	}

	if (client?.model?.list) {
		try {
			const modelsResult = await client.model.list()
			const models = modelsResult.data ?? []

			for (const model of models) {
				if (!model?.provider || !model?.id) continue
				if (connectedSet.has(model.provider)) {
					modelSet.add(`${model.provider}/${model.id}`)
				}
			}

			log("[fetchAvailableModels] fetched models from client (filtered)", {
				count: modelSet.size,
				connectedProviders: connectedProvidersList.slice(0, 5),
			})
		} catch (err) {
			log("[fetchAvailableModels] client.model.list error", { error: String(err) })
		}
	}

	return modelSet
}

export function isAnyFallbackModelAvailable(
	fallbackChain: Array<{ providers: string[]; model: string }>,
	availableModels: Set<string>,
): boolean {
	// If we have models, check them first
	if (availableModels.size > 0) {
		for (const entry of fallbackChain) {
			const hasAvailableProvider = entry.providers.some((provider) => {
				return fuzzyMatchModel(entry.model, availableModels, [provider]) !== null
			})
			if (hasAvailableProvider) {
				return true
			}
		}
	}

	// Fallback: check if any provider in the chain is connected
	// This handles race conditions where availableModels is empty or incomplete
	// but we know the provider is connected.
	const connectedProviders = connectedProvidersCache.readConnectedProvidersCache()
	if (connectedProviders) {
		const connectedSet = new Set(connectedProviders)
		for (const entry of fallbackChain) {
			if (entry.providers.some((p) => connectedSet.has(p))) {
				log("[isAnyFallbackModelAvailable] model not in available set, but provider is connected", {
					model: entry.model,
					availableCount: availableModels.size,
				})
				return true
			}
		}
	}

	return false
}

export function isAnyProviderConnected(
	providers: string[],
	availableModels: Set<string>,
): boolean {
	if (availableModels.size > 0) {
		const providerSet = new Set(providers)
		for (const model of availableModels) {
			const [provider] = model.split("/")
			if (providerSet.has(provider)) {
				log("[isAnyProviderConnected] found model from required provider", { provider, model })
				return true
			}
		}
	}

	const connectedProviders = connectedProvidersCache.readConnectedProvidersCache()
	if (connectedProviders) {
		const connectedSet = new Set(connectedProviders)
		for (const provider of providers) {
			if (connectedSet.has(provider)) {
				log("[isAnyProviderConnected] provider connected via cache", { provider })
				return true
			}
		}
	}

	return false
}

export function __resetModelCache(): void {}

export function isModelCacheAvailable(): boolean {
	if (connectedProvidersCache.hasProviderModelsCache()) {
		return true
	}
	const cacheFile = join(getOpenCodeCacheDir(), "models.json")
	return existsSync(cacheFile)
}
