import { readProviderModelsCache, type ModelMetadata } from "./connected-providers-cache"
import { detectHeuristicModelFamily } from "./model-capability-heuristics"
import { getModelCapabilities } from "./model-capabilities"
import { fuzzyMatchModel, resolveStableFamilyAlias } from "./model-availability"
import { normalizeModelID } from "./model-normalization"
import bundledModelCapabilitiesSnapshotJson from "../generated/model-capabilities.generated.json"

const BUNDLED_CANONICAL_PROVIDER = "__bundled_canonical__"

function normalizeBundledCanonicalLookupKey(model: string): string {
	return stripProviderPrefix(model)
		.trim()
		.toLowerCase()
		.replace(/(claude-(?:opus|sonnet|haiku)-)(\d)(?:[.-]?(\d+))(?=$|[-@:])/g, "$1$2.$3")
}

function hasExplicitClaudeMinorVersion(model: string): boolean {
	return /claude-(?:opus|sonnet|haiku)-\d+[.-]\d+/.test(model)
}

function hasDateSuffix(model: string): boolean {
	return /-\d{8}(?=$|[-@:])/.test(model)
}

function isThinkingVariant(model: string): boolean {
	return model.includes("think")
}

function isPreferredBundledCanonicalCandidate(
	candidate: string,
	current: string,
	lookupKey: string,
): boolean {
	const candidateModelID = stripProviderPrefix(candidate).trim().toLowerCase()
	const currentModelID = stripProviderPrefix(current).trim().toLowerCase()

	const candidateMatchesLookupKey = candidateModelID === lookupKey
	const currentMatchesLookupKey = currentModelID === lookupKey
	if (candidateMatchesLookupKey !== currentMatchesLookupKey) {
		return candidateMatchesLookupKey
	}

	const candidateHasExplicitClaudeMinorVersion = hasExplicitClaudeMinorVersion(candidateModelID)
	const currentHasExplicitClaudeMinorVersion = hasExplicitClaudeMinorVersion(currentModelID)
	if (candidateHasExplicitClaudeMinorVersion !== currentHasExplicitClaudeMinorVersion) {
		return candidateHasExplicitClaudeMinorVersion
	}

	const candidateIsStable = isThinkingVariant(candidateModelID) ? 0 : 1
	const currentIsStable = isThinkingVariant(currentModelID) ? 0 : 1
	if (candidateIsStable !== currentIsStable) {
		return candidateIsStable > currentIsStable
	}

	const candidateHasNoColon = candidateModelID.includes(":") ? 0 : 1
	const currentHasNoColon = currentModelID.includes(":") ? 0 : 1
	if (candidateHasNoColon !== currentHasNoColon) {
		return candidateHasNoColon > currentHasNoColon
	}

	const candidateHasNoAtSign = candidateModelID.includes("@") ? 0 : 1
	const currentHasNoAtSign = currentModelID.includes("@") ? 0 : 1
	if (candidateHasNoAtSign !== currentHasNoAtSign) {
		return candidateHasNoAtSign > currentHasNoAtSign
	}

	const candidateHasNoDateSuffix = hasDateSuffix(candidateModelID) ? 0 : 1
	const currentHasNoDateSuffix = hasDateSuffix(currentModelID) ? 0 : 1
	if (candidateHasNoDateSuffix !== currentHasNoDateSuffix) {
		return candidateHasNoDateSuffix > currentHasNoDateSuffix
	}

	return candidateModelID.length < currentModelID.length
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

function getBundledCanonicalModelSet(): Set<string> {
	const canonicalModelsByLookupKey = new Map<string, string>()
	const bundledModels = bundledModelCapabilitiesSnapshotJson.models ?? {}

	for (const modelKey of Object.keys(bundledModels)) {
		const strippedModelID = stripProviderPrefix(modelKey)
		const lookupKey = normalizeBundledCanonicalLookupKey(strippedModelID)
		const current = canonicalModelsByLookupKey.get(lookupKey)
		if (!current || isPreferredBundledCanonicalCandidate(strippedModelID, current, lookupKey)) {
			canonicalModelsByLookupKey.set(lookupKey, strippedModelID)
		}
	}

	const available = new Set<string>()
	for (const modelKey of canonicalModelsByLookupKey.values()) {
		available.add(`${BUNDLED_CANONICAL_PROVIDER}/${modelKey}`)
	}

	return available
}

function resolveFromBundledCanonicalSet(model: string, available: Set<string>): string | null {
	if (available.size === 0) {
		return null
	}

	const lookupKey = normalizeBundledCanonicalLookupKey(model)
	let preferredMatch: string | null = null

	for (const candidate of available) {
		const candidateModelID = stripProviderPrefix(candidate)
		if (normalizeBundledCanonicalLookupKey(candidateModelID) !== lookupKey) {
			continue
		}

		if (
			!preferredMatch
			|| isPreferredBundledCanonicalCandidate(candidateModelID, preferredMatch, lookupKey)
		) {
			preferredMatch = candidateModelID
		}
	}

	return preferredMatch
}

function applyCompatibilityFallback(model: string): string {
	return model
		.trim()
		.toLowerCase()
		.replace(/(claude-(?:opus|sonnet|haiku)-)(\d)(?:[.-]?(\d+))(?=$|[-@:])/g, "$1$2.$3")
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

	const canonicalSnapshotMatch = resolveFromBundledCanonicalSet(model, getBundledCanonicalModelSet())
	if (canonicalSnapshotMatch) {
		return canonicalSnapshotMatch
	}

	return applyCompatibilityFallback(model)
}
