import { log } from "./logger"
import type { FallbackEntry } from "./model-requirements"
import { readConnectedProvidersCache } from "./connected-providers-cache"
import { fuzzyMatchModel } from "./model-availability"

export type ModelResolutionInput = {
	userModel?: string
	inheritedModel?: string
	systemDefault?: string
}

export type ModelSource =
	| "override"
	| "category-default"
	| "provider-fallback"
	| "system-default"

export type ModelResolutionResult = {
	model: string
	source: ModelSource
	variant?: string
}

export type ExtendedModelResolutionInput = {
	uiSelectedModel?: string
	userModel?: string
	categoryDefaultModel?: string
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
	const { uiSelectedModel, userModel, categoryDefaultModel, fallbackModels, fallbackChain, availableModels, systemDefaultModel } = input
	const normalizedFallbackModels = normalizeFallbackModels(fallbackModels)

	// Step 1: UI Selection (highest priority - respects user's model choice in OpenCode UI)
	const normalizedUiModel = normalizeModel(uiSelectedModel)
	if (normalizedUiModel) {
		log("Model resolved via UI selection", { model: normalizedUiModel })
		return { model: normalizedUiModel, source: "override" }
	}

	// Step 2: Config Override (from oh-my-opencode.json user config)
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

	// Step 3: User-configured fallback_models
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

	// Step 4: Category Default Model (from DEFAULT_CATEGORIES, with fuzzy matching)
	const normalizedCategoryDefault = normalizeModel(categoryDefaultModel)
	if (normalizedCategoryDefault) {
		if (availableModels.size > 0) {
			const parts = normalizedCategoryDefault.split("/")
			const providerHint = parts.length >= 2 ? [parts[0]] : undefined
			const match = fuzzyMatchModel(normalizedCategoryDefault, availableModels, providerHint)
			if (match) {
				log("Model resolved via category default (fuzzy matched)", { original: normalizedCategoryDefault, matched: match })
				return { model: match, source: "category-default" }
			}
		} else {
			const connectedProviders = readConnectedProvidersCache()
			if (connectedProviders === null) {
				log("Model resolved via category default (no cache, first run)", { model: normalizedCategoryDefault })
				return { model: normalizedCategoryDefault, source: "category-default" }
			}
			const parts = normalizedCategoryDefault.split("/")
			if (parts.length >= 2) {
				const provider = parts[0]
				if (connectedProviders.includes(provider)) {
					log("Model resolved via category default (connected provider)", { model: normalizedCategoryDefault })
					return { model: normalizedCategoryDefault, source: "category-default" }
				}
			}
		}
		log("Category default model not available, falling through to fallback chain", { model: normalizedCategoryDefault })
	}

	// Step 5: Provider fallback chain (exact match → fuzzy match → next provider)
	if (fallbackChain && fallbackChain.length > 0) {
		if (availableModels.size === 0) {
			const connectedProviders = readConnectedProvidersCache()
			const connectedSet = connectedProviders ? new Set(connectedProviders) : null

			if (connectedSet === null) {
				log("Model fallback chain skipped (no connected providers cache) - falling through to system default")
			} else {
				for (const entry of fallbackChain) {
					for (const provider of entry.providers) {
						if (connectedSet.has(provider)) {
							const model = `${provider}/${entry.model}`
							log("Model resolved via fallback chain (connected provider)", { 
								provider, 
								model: entry.model, 
								variant: entry.variant,
							})
							return { model, source: "provider-fallback", variant: entry.variant }
						}
					}
				}
				log("No connected provider found in fallback chain, falling through to system default")
			}
		} else {
			for (const entry of fallbackChain) {
				// Step 5.1: Try with provider filter (preferred providers first)
				for (const provider of entry.providers) {
					const fullModel = `${provider}/${entry.model}`
					const match = fuzzyMatchModel(fullModel, availableModels, [provider])
					if (match) {
						log("Model resolved via fallback chain (availability confirmed)", { provider, model: entry.model, match, variant: entry.variant })
						return { model: match, source: "provider-fallback", variant: entry.variant }
					}
				}

				// Step 5.2: Try without provider filter (cross-provider fuzzy match)
				const crossProviderMatch = fuzzyMatchModel(entry.model, availableModels)
				if (crossProviderMatch) {
					log("Model resolved via fallback chain (cross-provider fuzzy match)", {
						model: entry.model,
						match: crossProviderMatch,
						variant: entry.variant,
					})
					return { model: crossProviderMatch, source: "provider-fallback", variant: entry.variant }
				}
			}
			log("No available model found in fallback chain, falling through to system default")
		}
	}

	// Step 6: System default (if provided)
	if (systemDefaultModel === undefined) {
		log("No model resolved - systemDefaultModel not configured")
		return undefined
	}

	log("Model resolved via system default", { model: systemDefaultModel })
	return { model: systemDefaultModel, source: "system-default" }
}
