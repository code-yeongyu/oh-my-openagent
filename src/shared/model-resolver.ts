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
	fallbackChain?: FallbackEntry[]
	availableModels: Set<string>
	systemDefaultModel?: string
}

function normalizeModel(model?: string): string | undefined {
	const trimmed = model?.trim()
	return trimmed || undefined
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
	const { uiSelectedModel, userModel, categoryDefaultModel, fallbackChain, availableModels, systemDefaultModel } = input

	// Step 1: UI Selection (highest priority - respects user's model choice in OpenCode UI)
	const normalizedUiModel = normalizeModel(uiSelectedModel)
	if (normalizedUiModel) {
		log("Model resolved via UI selection", { model: normalizedUiModel })
		return { model: normalizedUiModel, source: "override" }
	}

	// Step 2: Config Override (from oh-my-opencode.json user config)
	const normalizedUserModel = normalizeModel(userModel)
	if (normalizedUserModel) {
		log("Model resolved via config override", { model: normalizedUserModel })
		return { model: normalizedUserModel, source: "override" }
	}

	// Step 2.5: Category Default Model (from DEFAULT_CATEGORIES, with fuzzy matching)
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

	// Step 3: Provider fallback chain (exact match → fuzzy match → next provider)
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
	}

	// Step 4: System default (if provided)
	if (systemDefaultModel === undefined) {
		log("No model resolved - systemDefaultModel not configured")
		return undefined
	}

	log("Model resolved via system default", { model: systemDefaultModel })
	return { model: systemDefaultModel, source: "system-default" }
}
