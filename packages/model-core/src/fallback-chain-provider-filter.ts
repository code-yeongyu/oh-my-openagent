import type { FallbackEntry } from "./model-requirements";

export function filterFallbackChainByDisabledProviders<T extends FallbackEntry>(
	chain: readonly T[],
	disabledProviders: readonly string[] | undefined,
): readonly T[] {
	if (!disabledProviders || disabledProviders.length === 0) {
		return chain;
	}

	const disabledProviderSet = new Set(
		disabledProviders.map((provider) => provider.toLowerCase()),
	);
	const filteredChain = chain.filter(
		(entry) =>
			!entry.providers.some((provider) =>
				disabledProviderSet.has(provider.toLowerCase()),
			),
	);

	return filteredChain.length === chain.length ? chain : filteredChain;
}

export function getFirstAllowedFallbackEntry<T extends FallbackEntry>(
	chain: readonly T[],
	disabledProviders: readonly string[] | undefined,
): T | undefined {
	return filterFallbackChainByDisabledProviders(chain, disabledProviders)[0];
}
