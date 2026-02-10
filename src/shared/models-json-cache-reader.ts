import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { getOpenCodeCacheDir } from "./data-path"
import { log } from "./logger"
import { isRecord } from "./record-type-guard"

export function addModelsFromModelsJsonCache(
	connectedProviders: Set<string>,
	modelSet: Set<string>,
): boolean {
	const cacheFile = join(getOpenCodeCacheDir(), "models.json")
	if (!existsSync(cacheFile)) {
		log("[fetchAvailableModels] models.json cache file not found, falling back to client")
		return false
	}

	try {
		const content = readFileSync(cacheFile, "utf-8")
		const data: unknown = JSON.parse(content)
		if (!isRecord(data)) {
			return false
		}

		const providerIds = Object.keys(data)
		log("[fetchAvailableModels] providers found in models.json", {
			count: providerIds.length,
			providers: providerIds.slice(0, 10),
		})

		const previousSize = modelSet.size
		for (const providerId of providerIds) {
			if (!connectedProviders.has(providerId)) continue
			const providerValue = data[providerId]
			if (!isRecord(providerValue)) continue
			const modelsValue = providerValue["models"]
			if (!isRecord(modelsValue)) continue
			for (const modelKey of Object.keys(modelsValue)) {
				modelSet.add(`${providerId}/${modelKey}`)
			}
		}

		log("[fetchAvailableModels] parsed models from models.json (NO whitelist filtering)", {
			count: modelSet.size,
			connectedProviders: Array.from(connectedProviders).slice(0, 5),
		})

		return modelSet.size > previousSize
	} catch (err) {
		log("[fetchAvailableModels] error", { error: String(err) })
		return false
	}
}
