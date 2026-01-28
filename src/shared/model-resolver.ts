import { log } from "./logger"
import { fuzzyMatchModel } from "./model-availability"
import type { FallbackEntry } from "./model-requirements"
import { readConnectedProvidersCache } from "./connected-providers-cache"

export type ModelResolutionInput = {
	userModel?: string
	inheritedModel?: string
	systemDefault?: string
}

export type ModelSource =
	| "override"
	| "provider-fallback"
	| "system-default"

export type ModelResolutionResult = {
	model: string
	source: ModelSource
	variant?: string
}

export type ExtendedModelResolutionInput = {
	userModel?: string
	fallbackModels?: Array<string> | string
	fallbackChain?: FallbackEntry[]
	availableModels: Set<string>
	systemDefaultModel?: string
}

function normalizeModel(model?: string): string | undefined {
	const trimmed = model?.trim()
	return trimmed || undefined
}

function normalizeFallbackModels(models?: Array<string> | string): string[] {
	if (!models) return []
	const list = Array.isArray(models) ? models : [models]
	const out: string[] = []
	const seen = new Set<string>()
	for (const m of list) {
		const normalized = normalizeModel(m)
		if (!normalized) continue
		if (seen.has(normalized)) continue
		seen.add(normalized)
		out.push(normalized)
	}
	return out
}

function getProviderFromFullModel(fullModel: string): string | undefined {
	const idx = fullModel.indexOf("/")
	if (idx <= 0) return undefined
	return fullModel.slice(0, idx)
}

function isModelAvailableViaCache(fullModel: string, connectedProviders: string[] | null): boolean {
	if (!connectedProviders) return false
	const provider = getProviderFromFullModel(fullModel)
	if (!provider) return false
	return new Set(connectedProviders).has(provider)
}

function isModelAvailableViaList(fullModel: string, availableModels: Set<string>): string | null {
	if (availableModels.size === 0) return null
	const provider = getProviderFromFullModel(fullModel)
	return fuzzyMatchModel(fullModel, availableModels, provider ? [provider] : undefined) ?? null
}

export function resolveModel(input: ModelResolutionInput): string | undefined {
	return (
		normalizeModel(input.userModel) ??
		normalizeModel(input.inheritedModel) ??
		input.systemDefault
	)
}

export function resolveModelWithFallback(
	input: ExtendedModelResolutionInput,
): ModelResolutionResult | undefined {
	const { userModel, fallbackModels, fallbackChain, availableModels, systemDefaultModel } = input
	const normalizedFallbackModels = normalizeFallbackModels(fallbackModels)

	// Step 1: Override
	const normalizedUserModel = normalizeModel(userModel)
	if (normalizedUserModel) {
		if (normalizedFallbackModels.length === 0) {
			log("Model resolved via override", { model: normalizedUserModel })
			return { model: normalizedUserModel, source: "override" }
		}

		const match = isModelAvailableViaList(normalizedUserModel, availableModels)
		if (match) {
			log("Model resolved via override (availability confirmed)", { model: normalizedUserModel, match })
			return { model: match, source: "override" }
		}

		const connectedProviders = readConnectedProvidersCache()
		if (availableModels.size === 0 && connectedProviders === null) {
			// No cache available at all, keep override semantics to avoid surprising behavior.
			log("No cache available, keeping override model", { model: normalizedUserModel })
			return { model: normalizedUserModel, source: "override" }
		}
		if (availableModels.size === 0 && isModelAvailableViaCache(normalizedUserModel, connectedProviders)) {
			log("Model resolved via override (connected provider)", { model: normalizedUserModel })
			return { model: normalizedUserModel, source: "override" }
		}
		log("Override model not available, trying fallback_models", { model: normalizedUserModel })
	}

	// Step 1.5: User-configured fallback_models
	if (normalizedFallbackModels.length > 0) {
		if (availableModels.size === 0) {
			const connectedProviders = readConnectedProvidersCache()
			if (connectedProviders !== null) {
				for (const candidate of normalizedFallbackModels) {
					if (isModelAvailableViaCache(candidate, connectedProviders)) {
						log("Model resolved via fallback_models (connected provider)", { model: candidate })
						return { model: candidate, source: "provider-fallback" }
					}
				}
			}
		} else {
			for (const candidate of normalizedFallbackModels) {
				const match = isModelAvailableViaList(candidate, availableModels)
				if (match) {
					log("Model resolved via fallback_models (availability confirmed)", { model: candidate, match })
					return { model: match, source: "provider-fallback" }
				}
			}
		}
	}

	// Step 2: Provider fallback chain (with availability check)
	if (fallbackChain && fallbackChain.length > 0) {
		if (availableModels.size === 0) {
			const connectedProviders = readConnectedProvidersCache()
			const connectedSet = connectedProviders ? new Set(connectedProviders) : null

			// When no cache exists at all, skip fallback chain and fall through to system default
			// This allows OpenCode to use Provider.defaultModel() as the final fallback
			if (connectedSet === null) {
				log("No cache available, skipping fallback chain to use system default")
			} else {
				for (const entry of fallbackChain) {
					for (const provider of entry.providers) {
						if (connectedSet.has(provider)) {
							const model = `${provider}/${entry.model}`
							log("Model resolved via fallback chain (no model cache, using connected provider)", { 
								provider, 
								model: entry.model, 
								variant: entry.variant,
							})
							return { model, source: "provider-fallback", variant: entry.variant }
						}
					}
				}
				log("No matching provider in connected cache, falling through to system default")
			}
		}

		for (const entry of fallbackChain) {
			for (const provider of entry.providers) {
				const fullModel = `${provider}/${entry.model}`
				const match = fuzzyMatchModel(fullModel, availableModels, [provider])
				if (match) {
					log("Model resolved via fallback chain (availability confirmed)", { provider, model: entry.model, match, variant: entry.variant })
					return { model: match, source: "provider-fallback", variant: entry.variant }
				}
			}
		}
		log("No available model found in fallback chain, falling through to system default")
	}

	// Step 3: System default (if provided)
	if (systemDefaultModel === undefined) {
		log("No model resolved - systemDefaultModel not configured")
		return undefined
	}

	log("Model resolved via system default", { model: systemDefaultModel })
	return { model: systemDefaultModel, source: "system-default" }
}
