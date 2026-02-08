import { readProviderModelsCache } from "./connected-providers-cache"
import { log } from "./logger"

export function addModelsFromProviderModelsCache(
	connectedProviders: Set<string>,
	modelSet: Set<string>,
): boolean {
	const providerModelsCache = readProviderModelsCache()
	if (!providerModelsCache) {
		return false
	}

	const providerCount = Object.keys(providerModelsCache.models).length
	if (providerCount === 0) {
		log("[fetchAvailableModels] provider-models cache empty, falling back to models.json")
		return false
	}

	log("[fetchAvailableModels] using provider-models cache (whitelist-filtered)")
	const previousSize = modelSet.size

	for (const [providerId, modelIds] of Object.entries(providerModelsCache.models)) {
		if (!connectedProviders.has(providerId)) continue
		for (const modelItem of modelIds) {
			if (!modelItem) continue
			const modelId = typeof modelItem === "string" ? modelItem : modelItem.id
			if (modelId) {
				modelSet.add(`${providerId}/${modelId}`)
			}
		}
	}

	log("[fetchAvailableModels] parsed from provider-models cache", {
		count: modelSet.size,
		connectedProviders: Array.from(connectedProviders).slice(0, 5),
	})

	return modelSet.size > previousSize
}
