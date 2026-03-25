import type { FallbackEntry } from "./model-requirements"
import type { FallbackModelObject } from "../config/schema/fallback-models"
import { normalizeModel } from "./model-normalization"
import { resolveModelPipeline } from "./model-resolution-pipeline"
import { KNOWN_VARIANTS } from "./known-variants"

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
	userFallbackModels?: string[]
	categoryDefaultModel?: string
	fallbackChain?: FallbackEntry[]
	availableModels: Set<string>
	systemDefaultModel?: string
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
	const { uiSelectedModel, userModel, userFallbackModels, categoryDefaultModel, fallbackChain, availableModels, systemDefaultModel } = input
	const resolved = resolveModelPipeline({
		intent: { uiSelectedModel, userModel, userFallbackModels, categoryDefaultModel },
		constraints: { availableModels },
		policy: { fallbackChain, systemDefaultModel },
	})

	if (!resolved) {
		return undefined
	}

	return {
		model: resolved.model,
		source: resolved.provenance,
		variant: resolved.variant,
	}
}

/**
 * Normalizes fallback_models config to a mixed array.
 * Accepts string, string[], or mixed arrays of strings and FallbackModelObject entries.
 */
export function normalizeFallbackModels(
	models: string | (string | FallbackModelObject)[] | undefined,
): (string | FallbackModelObject)[] | undefined {
	if (!models) return undefined
	if (typeof models === "string") return [models]
	return models
}

/**
 * Extracts plain model strings from a mixed fallback models array.
 * Object entries are flattened to "model" or "model(variant)" strings.
 * Use this when consumers need string[] (e.g., resolveModelForDelegateTask).
 */
export function flattenToFallbackModelStrings(
	models: (string | FallbackModelObject)[] | undefined,
): string[] | undefined {
	if (!models) return undefined
	return models.map((entry) => {
		if (typeof entry === "string") return entry
		const variant = entry.variant
		if (variant) {
			// Strip any supported inline variant syntax before appending explicit override.
			// Supports both parenthesized and space-suffix forms so we don't emit
			// invalid strings like "provider/model high(low)".
			const model = entry.model
				.replace(/\([^()]+\)\s*$/, "")
				.replace(/\s+([a-z][a-z0-9_-]*)\s*$/i, (match, suffix) => {
					const normalized = String(suffix).toLowerCase()
					return KNOWN_VARIANTS.has(normalized)
						? ""
						: match
				})
				.trim()
			return `${model}(${variant})`
		}
		// No explicit variant — preserve model string as-is (including any inline variant)
		return entry.model
	})
}
