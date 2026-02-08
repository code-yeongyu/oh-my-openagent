import { addModelsFromModelsJsonCache } from "./models-json-cache-reader"
import { getModelListFunction, getProviderListFunction } from "./open-code-client-accessors"
import { addModelsFromProviderModelsCache } from "./provider-models-cache-model-reader"
import { log } from "./logger"

export async function getConnectedProviders(client: unknown): Promise<string[]> {
	const providerList = getProviderListFunction(client)
	if (!providerList) {
		log("[getConnectedProviders] client.provider.list not available")
		return []
	}

	try {
		const result = await providerList()
		const connected = result.data?.connected ?? []
		log("[getConnectedProviders] connected providers", {
			count: connected.length,
			providers: connected,
		})
		return connected
	} catch (err) {
		log("[getConnectedProviders] SDK error", { error: String(err) })
		return []
	}
}

export async function fetchAvailableModels(
	client?: unknown,
	options?: { connectedProviders?: string[] | null },
): Promise<Set<string>> {
	let connectedProviders = options?.connectedProviders ?? null
	let connectedProvidersUnknown = connectedProviders === null

	log("[fetchAvailableModels] CALLED", {
		connectedProvidersUnknown,
		connectedProviders: options?.connectedProviders,
	})

	if (connectedProvidersUnknown && client !== undefined) {
		const liveConnected = await getConnectedProviders(client)
		if (liveConnected.length > 0) {
			connectedProviders = liveConnected
			connectedProvidersUnknown = false
			log("[fetchAvailableModels] connected providers fetched from client", {
				count: liveConnected.length,
			})
		}
	}

	if (connectedProvidersUnknown) {
		const modelList = client === undefined ? null : getModelListFunction(client)
		if (modelList) {
			const modelSet = new Set<string>()
			try {
				const modelsResult = await modelList()
				const models = modelsResult.data ?? []
				for (const model of models) {
					if (model.provider && model.id) {
						modelSet.add(`${model.provider}/${model.id}`)
					}
				}
				log(
					"[fetchAvailableModels] fetched models from client without provider filter",
					{ count: modelSet.size },
				)
				return modelSet
			} catch (err) {
				log("[fetchAvailableModels] client.model.list error", {
					error: String(err),
				})
			}
		}
		log(
			"[fetchAvailableModels] connected providers unknown, returning empty set for fallback resolution",
		)
		return new Set<string>()
	}

	const connectedProvidersList = connectedProviders ?? []
	const connectedSet = new Set(connectedProvidersList)
	const modelSet = new Set<string>()

	if (addModelsFromProviderModelsCache(connectedSet, modelSet)) {
		return modelSet
	}
	log("[fetchAvailableModels] provider-models cache not found, falling back to models.json")
	if (addModelsFromModelsJsonCache(connectedSet, modelSet)) {
		return modelSet
	}

	const modelList = client === undefined ? null : getModelListFunction(client)
	if (modelList) {
		try {
			const modelsResult = await modelList()
			const models = modelsResult.data ?? []

			for (const model of models) {
				if (!model.provider || !model.id) continue
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
