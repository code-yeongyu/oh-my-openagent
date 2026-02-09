import {
	AGENT_MODEL_REQUIREMENTS,
	type FallbackEntry,
} from "../shared/model-requirements"
import type { ProviderAvailability } from "./model-fallback-types"
import { isProviderAvailable } from "./provider-availability"
import { transformModelForProvider } from "./provider-model-id-transform"

export function resolveModelFromChain(
	fallbackChain: FallbackEntry[],
	availability: ProviderAvailability
): { model: string; variant?: string } | null {
	for (const entry of fallbackChain) {
		for (const provider of entry.providers) {
			if (isProviderAvailable(provider, availability)) {
				const transformedModel = transformModelForProvider(provider, entry.model)
				return {
					model: `${provider}/${transformedModel}`,
					variant: entry.variant,
				}
			}
		}
	}
	return null
}

export function getSisyphusFallbackChain(): FallbackEntry[] {
	return AGENT_MODEL_REQUIREMENTS.sisyphus.fallbackChain
}

export function isAnyFallbackEntryAvailable(
	fallbackChain: FallbackEntry[],
	availability: ProviderAvailability
): boolean {
	return fallbackChain.some((entry) =>
		entry.providers.some((provider) => isProviderAvailable(provider, availability))
	)
}

export function isRequiredModelAvailable(
	requiresModel: string,
	fallbackChain: FallbackEntry[],
	availability: ProviderAvailability
): boolean {
	const matchingEntry = fallbackChain.find((entry) => entry.model === requiresModel)
	if (!matchingEntry) return false
	return matchingEntry.providers.some((provider) => isProviderAvailable(provider, availability))
}

export function isRequiredProviderAvailable(
	requiredProviders: string[],
	availability: ProviderAvailability
): boolean {
	return requiredProviders.some((provider) => isProviderAvailable(provider, availability))
}
