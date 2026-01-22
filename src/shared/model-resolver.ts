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

		// Step 3: Use first entry in fallbackChain as fallback (no availability match found)
		// This ensures category/agent intent is honored even if availableModels is incomplete
		const firstEntry = fallbackChain[0]
		if (firstEntry.providers.length > 0) {
			const fallbackModel = `${firstEntry.providers[0]}/${firstEntry.model}`
			log("Model resolved via fallback chain first entry (no availability match)", { model: fallbackModel, variant: firstEntry.variant })
			return { model: fallbackModel, source: "provider-fallback", variant: firstEntry.variant }
		}
	}

	// Step 4: System default
	log("Model resolved via system default", { model: systemDefaultModel })
	return { model: systemDefaultModel, source: "system-default" }
}
