import { log } from "./logger"
import type { FallbackEntry } from "./model-requirements"
import { resolveModelPipeline } from "./model-resolution-pipeline"

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
	const resolved = resolveModelPipeline({
		intent: { uiSelectedModel, userModel, categoryDefaultModel },
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
