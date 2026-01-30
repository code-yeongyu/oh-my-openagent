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
	uiSelectedModel?: string
	userModel?: string
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
	const { uiSelectedModel, userModel, fallbackChain, availableModels, systemDefaultModel } = input

	// Step 1: UI Selection (highest priority - respects user's model choice in OpenCode UI)
	const normalizedUiModel = normalizeModel(uiSelectedModel)
	if (normalizedUiModel) {
		log("Model resolved via UI selection", { model: normalizedUiModel })
		return { model: normalizedUiModel, source: "override" }
	}

	// Step 2: Config Override (from oh-my-opencode.json)
	const normalizedUserModel = normalizeModel(userModel)
	if (normalizedUserModel) {
		log("Model resolved via config override", { model: normalizedUserModel })
		return { model: normalizedUserModel, source: "override" }
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
