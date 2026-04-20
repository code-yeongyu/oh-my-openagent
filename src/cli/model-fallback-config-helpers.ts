import type { FallbackModelObject } from "../config/schema/fallback-models"
import type { FallbackEntry } from "../shared/model-requirements"
import type { AgentConfig, CategoryConfig, ProviderAvailability } from "./model-fallback-types"
import { isProviderAvailable } from "./provider-availability"
import { transformModelForProvider } from "./provider-model-id-transform"

function normalizeVariantForProvider(provider: string, variant?: string): string | undefined {
	if (!variant || provider !== "github-copilot") {
		return variant
	}

	if (variant === "max" || variant === "xhigh") {
		return "high"
	}

	return variant
}

export function normalizeResolvedVariant(model: string, variant?: string): string | undefined {
	const [provider] = model.split("/", 1)
	return normalizeVariantForProvider(provider, variant)
}

function toFallbackModelObject(entry: FallbackEntry, provider: string): FallbackModelObject {
	const variant = normalizeVariantForProvider(provider, entry.variant)

	return {
		model: `${provider}/${transformModelForProvider(provider, entry.model)}`,
		...(variant ? { variant } : {}),
		...(entry.reasoningEffort ? { reasoningEffort: entry.reasoningEffort as FallbackModelObject["reasoningEffort"] } : {}),
		...(entry.temperature !== undefined ? { temperature: entry.temperature } : {}),
		...(entry.top_p !== undefined ? { top_p: entry.top_p } : {}),
		...(entry.maxTokens !== undefined ? { maxTokens: entry.maxTokens } : {}),
		...(entry.thinking ? { thinking: entry.thinking } : {}),
	}
}

function collectAvailableFallbacks(
	fallbackChain: FallbackEntry[],
	availability: ProviderAvailability,
): FallbackModelObject[] {
	const expandedFallbacks = fallbackChain.flatMap((entry) =>
		entry.providers
			.filter((provider) => isProviderAvailable(provider, availability))
			.map((provider) => toFallbackModelObject(entry, provider))
	)

	return expandedFallbacks.filter((entry, index, allEntries) =>
		allEntries.findIndex((candidate) =>
			candidate.model === entry.model &&
			candidate.variant === entry.variant
		) === index
	)
}

export function attachFallbackModels<T extends AgentConfig | CategoryConfig>(
	config: T,
	fallbackChain: FallbackEntry[],
	availability: ProviderAvailability,
): T {
	const uniqueFallbacks = collectAvailableFallbacks(fallbackChain, availability)
	const primaryIndex = uniqueFallbacks.findIndex((entry) => entry.model === config.model)
	if (primaryIndex === -1) {
		return config
	}

	const fallbackModels = uniqueFallbacks.slice(primaryIndex + 1)
	if (fallbackModels.length === 0) {
		return config
	}

	return {
		...config,
		fallback_models: fallbackModels,
	}
}

export function attachAllFallbackModels<T extends AgentConfig | CategoryConfig>(
	config: T,
	fallbackChain: FallbackEntry[],
	availability: ProviderAvailability,
): T {
	const uniqueFallbacks = collectAvailableFallbacks(fallbackChain, availability)
	const fallbackModels = uniqueFallbacks.filter((entry) => entry.model !== config.model)
	if (fallbackModels.length === 0) {
		return config
	}

	return {
		...config,
		fallback_models: fallbackModels,
	}
}
