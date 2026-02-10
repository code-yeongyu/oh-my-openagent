import { readConnectedProvidersCache } from "./connected-providers-cache"
import { log } from "./logger"
import { fuzzyMatchModel } from "./model-name-matcher"

export function isAnyFallbackModelAvailable(
	fallbackChain: Array<{ providers: string[]; model: string }>,
	availableModels: Set<string>,
): boolean {
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

	const connectedProviders = readConnectedProvidersCache()
	if (connectedProviders) {
		const connectedSet = new Set(connectedProviders)
		for (const entry of fallbackChain) {
			if (entry.providers.some((p) => connectedSet.has(p))) {
				log(
					"[isAnyFallbackModelAvailable] model not in available set, but provider is connected",
					{ model: entry.model, availableCount: availableModels.size },
				)
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
				log("[isAnyProviderConnected] found model from required provider", {
					provider,
					model,
				})
				return true
			}
		}
	}

	const connectedProviders = readConnectedProvidersCache()
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
