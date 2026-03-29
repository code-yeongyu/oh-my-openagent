import { readProviderModelsCache, type ModelMetadata } from "./connected-providers-cache"
import { getModelCapabilities } from "./model-capabilities"
import { fuzzyMatchModel } from "./model-availability"
import bundledModelCapabilitiesSnapshotJson from "../generated/model-capabilities.generated.json"

function extractProviderModelID(entry: string | ModelMetadata): string | null {
	if (typeof entry === "string") return entry
	return typeof entry?.id === "string" ? entry.id : null
}

function stripProviderPrefix(model: string): string {
	const slashIndex = model.indexOf("/")
	return slashIndex === -1 ? model : model.slice(slashIndex + 1)
}

function resolveFromAvailableSet(provider: string, model: string, available: Set<string>): string | null {
	if (available.size === 0) {
		return null
	}

	const directMatch = fuzzyMatchModel(model, available, [provider])
	if (directMatch) {
		return stripProviderPrefix(directMatch)
	}

	// Claude families have stable aliases ("claude-opus", "claude-sonnet") that let
	// version-pinned legacy requests resolve to whatever version the provider exposes.
	const family = getModelCapabilities({ providerID: provider, modelID: model }).family
	if (family?.startsWith("claude-")) {
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

function applyCompatibilityFallback(provider: string, model: string): string {
	if (provider === "github-copilot") {
		return model
			.replace("claude-opus-4-6", "claude-opus-4.6")
			.replace("claude-sonnet-4-6", "claude-sonnet-4.6")
			.replace("claude-sonnet-4-5", "claude-sonnet-4.5")
			.replace("claude-haiku-4-5", "claude-haiku-4.5")
			.replace("claude-sonnet-4", "claude-sonnet-4")
			.replace(/gemini-3\.1-pro(?!-)/g, "gemini-3.1-pro-preview")
			.replace(/gemini-3-flash(?!-)/g, "gemini-3-flash-preview")
	}
	if (provider === "google") {
		return model
			.replace(/gemini-3\.1-pro(?!-)/g, "gemini-3.1-pro-preview")
			.replace(/gemini-3-flash(?!-)/g, "gemini-3-flash-preview")
	}
	if (provider === "anthropic") {
		return model
			.replace("claude-opus-4-6", "claude-opus-4.6")
			.replace("claude-sonnet-4-6", "claude-sonnet-4.6")
			.replace("claude-haiku-4-5", "claude-haiku-4.5")
	}
	return model
}

export function transformModelForProvider(provider: string, model: string): string {
	const cacheMatch = resolveFromAvailableSet(provider, model, getProviderCacheModelSet(provider))
	if (cacheMatch) {
		return cacheMatch
	}

	const snapshotMatch = resolveFromAvailableSet(provider, model, getBundledSnapshotModelSet(provider))
	if (snapshotMatch) {
		return snapshotMatch
	}

	return applyCompatibilityFallback(provider, model)
}
