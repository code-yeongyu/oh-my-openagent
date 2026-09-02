import { filterFallbackChainByDisabledProviders } from "./fallback-chain-provider-filter";
import type {
	ModelResolutionDeps,
	ModelResolutionResult,
} from "./model-resolution-pipeline";
import type { FallbackEntry } from "./model-requirements";
import type { ProviderCache } from "./provider-cache";

type LogModelResolution = (message: string, data?: unknown) => void;

type HardcodedFallbackResolutionInput = {
	readonly fallbackChain: readonly FallbackEntry[] | undefined;
	readonly disabledProviders: readonly string[] | undefined;
	readonly availableModels: Set<string>;
	readonly connectedProviders: readonly string[] | null | undefined;
	readonly attempted: string[];
	readonly providerCache: ProviderCache;
	readonly deps: ModelResolutionDeps;
	readonly log: LogModelResolution;
};

function modelIDForProvider(provider: string, model: string): string {
	const prefix = `${provider}/`;
	return model.startsWith(prefix) ? model.slice(prefix.length) : model;
}

export function resolveHardcodedFallback({
	fallbackChain,
	disabledProviders,
	availableModels,
	connectedProviders,
	attempted,
	providerCache,
	deps,
	log,
}: HardcodedFallbackResolutionInput): ModelResolutionResult | undefined {
	if (!fallbackChain || fallbackChain.length === 0) {
		return undefined;
	}

	const allowedChain = filterFallbackChainByDisabledProviders(
		fallbackChain,
		disabledProviders,
	);
	if (availableModels.size === 0) {
		const connected = connectedProviders ?? providerCache.readConnectedProvidersCache();
		const connectedSet = connected ? new Set(connected) : null;
		if (connectedSet === null) {
			log("Model fallback chain skipped (no connected providers cache) - falling through to system default");
			return undefined;
		}

		for (const entry of allowedChain) {
			for (const provider of entry.providers) {
				if (!connectedSet.has(provider)) {
					continue;
				}
				const entryModelID = modelIDForProvider(provider, entry.model);
				const transformedModelId = deps.transformModelForProvider(provider, entryModelID);
				log("Model resolved via fallback chain (connected provider)", {
					provider,
					model: transformedModelId,
					variant: entry.variant,
				});
				return {
					model: `${provider}/${transformedModelId}`,
					provenance: "provider-fallback",
					variant: entry.variant,
					attempted,
				};
			}
		}
		log("No connected provider found in fallback chain, falling through to system default");
		return undefined;
	}

	for (const entry of allowedChain) {
		for (const provider of entry.providers) {
			const entryModelID = modelIDForProvider(provider, entry.model);
			const transformedModelId = deps.transformModelForProvider(provider, entryModelID);
			const candidateModelIds =
				transformedModelId === entryModelID
					? [entryModelID]
					: [entryModelID, transformedModelId];
			for (const modelID of candidateModelIds) {
				const match = deps.fuzzyMatchModel(
					`${provider}/${modelID}`,
					availableModels,
					[provider],
				);
				if (!match) {
					continue;
				}
				log("Model resolved via fallback chain (availability confirmed)", {
					provider,
					model: entry.model,
					match,
					variant: entry.variant,
				});
				return {
					model: match,
					provenance: "provider-fallback",
					variant: entry.variant,
					attempted,
				};
			}
		}
	}
	log("No available model found in fallback chain, falling through to system default");
	return undefined;
}
