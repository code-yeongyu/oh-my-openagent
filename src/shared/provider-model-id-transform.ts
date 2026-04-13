import { readProviderModelsCache, type ModelMetadata } from "./connected-providers-cache"
import { detectHeuristicModelFamily } from "./model-capability-heuristics"
import { getModelCapabilities } from "./model-capabilities"
import { fuzzyMatchModel, resolveStableFamilyAlias } from "./model-availability"
import { normalizeModelID } from "./model-normalization"
import bundledModelCapabilitiesSnapshotJson from "../generated/model-capabilities.generated.json"

function applyCompatibilityFallback(provider: string, model: string): string {
	const trimmedModel = model.trim()
	if (provider !== "github-copilot") {
		return trimmedModel
	}

	return trimmedModel.replace(
		/(claude-(?:opus|sonnet|haiku)-)(\d)(?:[.-]?(\d+))(?=$|[-@:])/gi,
		"$1$2.$3",
	)
}

function extractProviderModelID(entry: string | ModelMetadata): string | null {
	if (typeof entry === "string") return entry
	return typeof entry?.id === "string" ? entry.id : null
}

function stripProviderPrefix(model: string): string {
	const slashIndex = model.indexOf("/")
	return slashIndex === -1 ? model : model.slice(slashIndex + 1)
}

function getProviderCandidates(provider: string, available: Set<string>): string[] {
	return Array.from(available).filter((candidate) => candidate.startsWith(`${provider}/`))
}

function resolveExactProviderCandidate(
	provider: string,
	model: string,
	available: Set<string>,
): string | null {
	const candidates = getProviderCandidates(provider, available)
	if (candidates.length === 0) {
		return null
	}

	const requestedModelID = stripProviderPrefix(model).trim().toLowerCase()
	const exactRawMatch = candidates.find(
		(candidate) => stripProviderPrefix(candidate).trim().toLowerCase() === requestedModelID,
	)
	if (exactRawMatch) {
		return stripProviderPrefix(exactRawMatch)
	}

	const normalizedRequestedModelID = normalizeModelID(requestedModelID)
	const exactNormalizedMatch = candidates.find(
		(candidate) =>
			normalizeModelID(stripProviderPrefix(candidate).trim().toLowerCase()) === normalizedRequestedModelID,
	)
	return exactNormalizedMatch ? stripProviderPrefix(exactNormalizedMatch) : null
}

function resolveFromAvailableSet(
	provider: string,
	model: string,
	available: Set<string>,
	options?: { allowFamilyFallback?: boolean },
): string | null {
	if (available.size === 0) {
		return null
	}

	const family = getModelCapabilities({ providerID: provider, modelID: model }).family
	const normalizedRequestedModelID = normalizeModelID(stripProviderPrefix(model).trim().toLowerCase())
	const heuristicFamily = detectHeuristicModelFamily(normalizedRequestedModelID)?.family
	const requestedFloatingFamilyAlias = (
		heuristicFamily !== undefined && normalizedRequestedModelID === heuristicFamily
	) || (
		family !== undefined && normalizedRequestedModelID === family
	)
	if (options?.allowFamilyFallback !== false && requestedFloatingFamilyAlias) {
		const aliasFamily = heuristicFamily ?? family
		const concreteFamilyCandidates = getProviderCandidates(provider, available).filter(
			(candidate) =>
				normalizeModelID(stripProviderPrefix(candidate).trim().toLowerCase()) !== aliasFamily,
		)
		const concreteFamilyMatch = aliasFamily
			? resolveStableFamilyAlias(aliasFamily, concreteFamilyCandidates)
			: null
		if (concreteFamilyMatch) {
			return stripProviderPrefix(concreteFamilyMatch)
		}
	}

	const exactCandidate = resolveExactProviderCandidate(provider, model, available)
	if (exactCandidate) {
		return exactCandidate
	}

	const directMatch = fuzzyMatchModel(model, available, [provider])
	if (directMatch) {
		return stripProviderPrefix(directMatch)
	}

	// Claude families have stable aliases ("claude-opus", "claude-sonnet") that let
	// version-pinned legacy requests resolve to whatever version the provider exposes.
	if (options?.allowFamilyFallback !== false && family?.startsWith("claude-")) {
		const familyMatch = fuzzyMatchModel(family, available, [provider])
		if (familyMatch) {
			return stripProviderPrefix(familyMatch)
		}
	}

	return null
}

function getProviderCacheModelSet(provider: string): Set<string> {
	const available = new Set<string>()
	const providerModels = readProviderModelsCache()?.models?.[provider]
	if (!providerModels || providerModels.length === 0) {
		return available
	}

	for (const entry of providerModels) {
		const modelID = extractProviderModelID(entry)
		if (modelID) {
			available.add(`${provider}/${modelID}`)
		}
	}

	return available
}

function getBundledSnapshotModelSet(provider: string): Set<string> {
	const available = new Set<string>()
	const bundledModels = bundledModelCapabilitiesSnapshotJson.models ?? {}

	for (const modelKey of Object.keys(bundledModels)) {
		if (modelKey.startsWith(`${provider}/`)) {
			available.add(modelKey)
		}
	}

	return available
}

export function transformModelForProvider(
	provider: string,
	model: string,
	options?: { allowFamilyFallback?: boolean },
): string {
	const cacheMatch = resolveFromAvailableSet(
		provider,
		model,
		getProviderCacheModelSet(provider),
		options,
	)
	if (cacheMatch) {
		return cacheMatch
	}

	const snapshotMatch = resolveFromAvailableSet(
		provider,
		model,
		getBundledSnapshotModelSet(provider),
		options,
	)
	if (snapshotMatch) {
		return snapshotMatch
	}

	return applyCompatibilityFallback(provider, model)
}
