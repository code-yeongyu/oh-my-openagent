import { log } from "./logger"
import { fuzzyMatchModel } from "./model-availability"
import type { FallbackEntry } from "./model-requirements"

export type ModelResolutionInput = {
	userModel?: string
	inheritedModel?: string
	systemDefault: string
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
	fallbackChain?: FallbackEntry[]
	availableModels: Set<string>
	systemDefaultModel: string
}

function normalizeModel(model?: string): string | undefined {
	const trimmed = model?.trim()
	return trimmed || undefined
}

export function resolveModel(input: ModelResolutionInput): string {
	return (
		normalizeModel(input.userModel) ??
		normalizeModel(input.inheritedModel) ??
		input.systemDefault
	)
}

export function resolveModelWithFallback(
	input: ExtendedModelResolutionInput,
): ModelResolutionResult {
	const { userModel, fallbackChain, availableModels, systemDefaultModel } = input

	// Step 1: Override
	const normalizedUserModel = normalizeModel(userModel)
	if (normalizedUserModel) {
		log("Model resolved via override", { model: normalizedUserModel })
		return { model: normalizedUserModel, source: "override" }
	}

	// Step 2: Provider fallback chain (with availability check)
	if (fallbackChain && fallbackChain.length > 0) {
		// If availableModels is empty (no cache), use first fallback entry directly without availability check
		if (availableModels.size === 0) {
			const firstEntry = fallbackChain[0]
			const firstProvider = firstEntry.providers[0]
			const model = `${firstProvider}/${firstEntry.model}`
			log("Model resolved via fallback chain (no cache, using first entry)", { provider: firstProvider, model: firstEntry.model, variant: firstEntry.variant })
			return { model, source: "provider-fallback", variant: firstEntry.variant }
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
		// No match found in fallback chain - fall through to system default
		log("No available model found in fallback chain, falling through to system default")
	}

	// Step 4: System default
	log("Model resolved via system default", { model: systemDefaultModel })
	return { model: systemDefaultModel, source: "system-default" }
}
