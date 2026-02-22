import { readConnectedProvidersCache } from "./connected-providers-cache"
import { log } from "./logger"
import { fuzzyMatchModel } from "./model-name-matcher"

type FallbackEntry = { providers: string[]; model: string }

type ResolvedFallbackModel = {
	provider: string
	model: string
}

export function resolveFirstAvailableFallback(
	fallbackChain: FallbackEntry[],
	availableModels: Set<string>,
): ResolvedFallbackModel | null {
	for (const entry of fallbackChain) {
		for (const provider of entry.providers) {
			const matchedModel = fuzzyMatchModel(entry.model, availableModels, [provider])
			log("[resolveFirstAvailableFallback] attempt", {
				provider,
				requestedModel: entry.model,
				resolvedModel: matchedModel,
			})

			if (matchedModel !== null) {
				log("[resolveFirstAvailableFallback] resolved", {
					provider,
					requestedModel: entry.model,
					resolvedModel: matchedModel,
				})
				return { provider, model: matchedModel }
			}
		}
	}

	log("[resolveFirstAvailableFallback] WARNING: no fallback model resolved", {
		chain: fallbackChain.map((entry) => ({
			model: entry.model,
			providers: entry.providers,
		})),
		availableCount: availableModels.size,
	})

	return null
}

export function isAnyFallbackModelAvailable(
	fallbackChain: FallbackEntry[],
	availableModels: Set<string>,
): boolean {
	if (resolveFirstAvailableFallback(fallbackChain, availableModels) !== null) {
		return true
	}

	const connectedProviders = readConnectedProvidersCache()
	if (connectedProviders) {
		const connectedSet = new Set(connectedProviders)
		for (const entry of fallbackChain) {
			if (entry.providers.some((p) => connectedSet.has(p))) {
				log(
					"[isAnyFallbackModelAvailable] WARNING: No fuzzy match found for any model in fallback chain, but provider is connected. Agent may fail at runtime.",
					{ chain: fallbackChain.map((entryItem) => entryItem.model), availableCount: availableModels.size },
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
