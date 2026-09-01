import { resolveModelIDAlias } from "../model-capability-aliases"
import { detectHeuristicModelFamily } from "../model-capability-heuristics"
import { parseVariantFromModelID } from "../model-string-parser"
import type { ModelMetadata, ProviderCache } from "../provider-cache"

import {
	readRuntimeModel,
	readRuntimeModelLimitOutput,
	readRuntimeModelModalities,
	readRuntimeModelReasoningSupport,
	readRuntimeModelTemperatureSupport,
	readRuntimeModelThinkingSupport,
	readRuntimeModelToolCallSupport,
	readRuntimeModelTopPSupport,
	readRuntimeModelVariants,
} from "./runtime-model-readers"
import type {
	GetModelCapabilitiesInput,
	ModelCapabilities,
	ModelCapabilitiesDiagnostics,
	ModelCapabilityOverride,
} from "./types"

const MODEL_ID_OVERRIDES: Record<string, ModelCapabilityOverride> = {}
const GITHUB_COPILOT_GPT5_MODEL = /(?:^|\/)gpt-5(?:[.-]|$)/
const GITHUB_COPILOT_GPT5_OVERRIDE: ModelCapabilityOverride = {
	variants: ["low", "medium", "high"],
	reasoningEfforts: ["none", "minimal", "low", "medium", "high"],
}

function normalizeLookupModelID(modelID: string): string {
	return modelID.trim().toLowerCase()
}

function getOverride(modelID: string): ModelCapabilityOverride | undefined {
	return MODEL_ID_OVERRIDES[normalizeLookupModelID(modelID)]
}

function getProviderOverride(providerID: string, modelID: string): ModelCapabilityOverride | undefined {
	if (providerID.trim().toLowerCase() !== "github-copilot") return undefined
	return GITHUB_COPILOT_GPT5_MODEL.test(normalizeLookupModelID(modelID))
		? GITHUB_COPILOT_GPT5_OVERRIDE
		: undefined
}

function stripSameProviderPrefix(providerID: string, modelID: string): string | undefined {
	const prefix = `${providerID.trim()}/`
	return prefix !== "/" && modelID.slice(0, prefix.length).toLowerCase() === prefix.toLowerCase()
		? modelID.slice(prefix.length)
		: undefined
}

function buildLookupCandidates(providerID: string, modelID: string): string[] {
	const bareModelID = parseVariantFromModelID(modelID, { allowMaxSuffix: true }).modelID
	const candidates = [
		modelID,
		stripSameProviderPrefix(providerID, modelID),
		bareModelID,
		stripSameProviderPrefix(providerID, bareModelID),
	]
	const uniqueCandidates: string[] = []
	const seen = new Set<string>()
	for (const candidate of candidates) {
		if (!candidate || seen.has(candidate)) continue
		seen.add(candidate)
		uniqueCandidates.push(candidate)
	}
	return uniqueCandidates
}

// The provider cache matches ids exactly (`entry.id === modelID`), so a request carrying a
// reasoning suffix or same-provider prefix can miss the model the provider advertised.
// More specific forms are tried first so exact suffixed metadata still wins.
function findProviderMetadata(
	providerCache: ProviderCache | undefined,
	providerID: string,
	modelID: string,
): ModelMetadata | undefined {
	if (!providerCache) return undefined
	for (const candidate of buildLookupCandidates(providerID, modelID)) {
		const match = providerCache.findProviderModelMetadata(providerID, candidate)
		if (match) return match
	}
	return undefined
}

function findSnapshotEntry(
	snapshot: GetModelCapabilitiesInput["runtimeSnapshot"],
	providerID: string,
	modelIDs: readonly string[],
) {
	if (!snapshot) return undefined
	const normalizedProviderID = providerID.trim()
	const providerSpecificCandidates: string[] = []
	const generalCandidates: string[] = []
	for (const modelID of modelIDs) {
		const strippedModelID = stripSameProviderPrefix(providerID, modelID)
		const unqualifiedModelID = strippedModelID ?? (modelID.includes("/") ? undefined : modelID)
		if (!unqualifiedModelID) {
			generalCandidates.push(...buildLookupCandidates(providerID, modelID))
			continue
		}
		const bareModelID = parseVariantFromModelID(unqualifiedModelID, { allowMaxSuffix: true }).modelID
		if (normalizedProviderID) {
			providerSpecificCandidates.push(
				`${normalizedProviderID}/${unqualifiedModelID}`,
				`${normalizedProviderID}/${bareModelID}`,
			)
		}
		generalCandidates.push(unqualifiedModelID, bareModelID)
	}
	const seen = new Set<string>()
	for (const candidate of [...providerSpecificCandidates, ...generalCandidates]) {
		if (seen.has(candidate)) continue
		seen.add(candidate)
		const entry = snapshot.models[candidate]
		if (entry) return entry
	}
	return undefined
}

function resolveCapabilityModelAlias(modelID: string, providerID: string) {
	const direct = resolveModelIDAlias(modelID, providerID)
	if (direct.source !== "canonical") return direct
	const bareModelID = parseVariantFromModelID(modelID, { allowMaxSuffix: true }).modelID
	if (bareModelID === modelID) return direct
	const bareAlias = resolveModelIDAlias(bareModelID, providerID)
	return bareAlias.source === "canonical"
		? direct
		: { ...bareAlias, requestedModelID: modelID }
}

export function getModelCapabilities(input: GetModelCapabilitiesInput): ModelCapabilities {
	const canonicalization = resolveCapabilityModelAlias(input.modelID, input.providerID)
	const override = getOverride(input.modelID)
	const providerOverride = getProviderOverride(input.providerID, canonicalization.canonicalModelID)
	const runtimeModel = readRuntimeModel(
		input.runtimeModel ?? findProviderMetadata(input.providerCache, input.providerID, input.modelID),
	)
	const runtimeSnapshot = input.runtimeSnapshot
	const bundledSnapshot = input.bundledSnapshot
	const snapshotModelIDs = canonicalization.source === "canonical"
		? [input.modelID, canonicalization.canonicalModelID]
		: [canonicalization.canonicalModelID, input.modelID]
	const runtimeSnapshotEntry = findSnapshotEntry(
		runtimeSnapshot,
		input.providerID,
		snapshotModelIDs,
	)
	const bundledSnapshotEntry = findSnapshotEntry(
		bundledSnapshot,
		input.providerID,
		snapshotModelIDs,
	)
	const snapshotEntry = runtimeSnapshotEntry ?? bundledSnapshotEntry
	const heuristicFamily = detectHeuristicModelFamily(canonicalization.canonicalModelID)

	const runtimeVariants = readRuntimeModelVariants(runtimeModel)
	const runtimeReasoning = readRuntimeModelReasoningSupport(runtimeModel)
	const runtimeThinking = readRuntimeModelThinkingSupport(runtimeModel)
	const runtimeTemperature = readRuntimeModelTemperatureSupport(runtimeModel)
	const runtimeTopP = readRuntimeModelTopPSupport(runtimeModel)
	const runtimeMaxOutputTokens = readRuntimeModelLimitOutput(runtimeModel)
	const runtimeToolCall = readRuntimeModelToolCallSupport(runtimeModel)
	const runtimeModalities = readRuntimeModelModalities(runtimeModel)

	const snapshotSource: ModelCapabilitiesDiagnostics["snapshot"]["source"] =
		runtimeSnapshotEntry
			? "runtime-snapshot"
			: bundledSnapshotEntry
			? "bundled-snapshot"
			: "none"
	const familySource: ModelCapabilitiesDiagnostics["family"]["source"] =
		snapshotEntry?.family ? "snapshot" : heuristicFamily?.family ? "heuristic" : "none"
	const variantsSource: ModelCapabilitiesDiagnostics["variants"]["source"] =
		runtimeVariants ? "runtime" : providerOverride?.variants ? "override" : override?.variants ? "override" : heuristicFamily?.variants ? "heuristic" : "none"
	const reasoningEffortsSource: ModelCapabilitiesDiagnostics["reasoningEfforts"]["source"] =
		providerOverride?.reasoningEfforts ? "override" : override?.reasoningEfforts ? "override" : heuristicFamily?.reasoningEfforts ? "heuristic" : "none"
	const reasoningSource: ModelCapabilitiesDiagnostics["reasoning"]["source"] =
		runtimeReasoning === undefined ? snapshotEntry?.reasoning === undefined ? "none" : snapshotSource : "runtime"
	const supportsThinkingSource: ModelCapabilitiesDiagnostics["supportsThinking"]["source"] =
		override?.supportsThinking !== undefined
			? "override"
			: runtimeThinking !== undefined
			? "runtime"
			: snapshotEntry?.reasoning !== undefined
			? snapshotSource
			: heuristicFamily?.supportsThinking !== undefined
			? "heuristic"
			: "none"
	const supportsTemperatureSource: ModelCapabilitiesDiagnostics["supportsTemperature"]["source"] =
		runtimeTemperature !== undefined
			? "runtime"
			: override?.supportsTemperature !== undefined
			? "override"
			: snapshotEntry?.temperature !== undefined
			? snapshotSource
			: "none"
	const supportsTopPSource: ModelCapabilitiesDiagnostics["supportsTopP"]["source"] =
		runtimeTopP !== undefined ? "runtime" : override?.supportsTopP !== undefined ? "override" : "none"
	const maxOutputTokensSource: ModelCapabilitiesDiagnostics["maxOutputTokens"]["source"] =
		runtimeMaxOutputTokens !== undefined
			? "runtime"
			: snapshotEntry?.limit?.output !== undefined
			? snapshotSource
			: "none"
	const toolCallSource: ModelCapabilitiesDiagnostics["toolCall"]["source"] =
		runtimeToolCall !== undefined ? "runtime" : snapshotEntry?.toolCall !== undefined ? snapshotSource : "none"
	const modalitiesSource: ModelCapabilitiesDiagnostics["modalities"]["source"] =
		runtimeModalities !== undefined ? "runtime" : snapshotEntry?.modalities !== undefined ? snapshotSource : "none"
	const resolutionMode: ModelCapabilitiesDiagnostics["resolutionMode"] =
		canonicalization.source === "canonical"
			? snapshotSource !== "none"
				? "snapshot-backed"
				: familySource === "heuristic" || variantsSource === "heuristic" || reasoningEffortsSource === "heuristic"
					? "heuristic-backed"
					: "unknown"
			: "alias-backed"

	return {
		requestedModelID: canonicalization.requestedModelID,
		canonicalModelID: canonicalization.canonicalModelID,
		family: snapshotEntry?.family ?? heuristicFamily?.family,
		variants: runtimeVariants ?? providerOverride?.variants ?? override?.variants ?? heuristicFamily?.variants,
		reasoningEfforts: providerOverride?.reasoningEfforts ?? override?.reasoningEfforts ?? heuristicFamily?.reasoningEfforts,
		reasoning: runtimeReasoning ?? snapshotEntry?.reasoning,
		supportsThinking: override?.supportsThinking ?? runtimeThinking ?? snapshotEntry?.reasoning ?? heuristicFamily?.supportsThinking,
		supportsTemperature: runtimeTemperature ?? override?.supportsTemperature ?? snapshotEntry?.temperature,
		supportsTopP: runtimeTopP ?? override?.supportsTopP,
		maxOutputTokens: runtimeMaxOutputTokens ?? snapshotEntry?.limit?.output,
		toolCall: runtimeToolCall ?? snapshotEntry?.toolCall,
		modalities: runtimeModalities ?? snapshotEntry?.modalities,
		diagnostics: {
			resolutionMode,
			canonicalization: {
				source: canonicalization.source,
				...(canonicalization.ruleID ? { ruleID: canonicalization.ruleID } : {}),
			},
			snapshot: { source: snapshotSource },
			family: { source: familySource },
			variants: { source: variantsSource },
			reasoningEfforts: { source: reasoningEffortsSource },
			reasoning: { source: reasoningSource },
			supportsThinking: { source: supportsThinkingSource },
			supportsTemperature: { source: supportsTemperatureSource },
			supportsTopP: { source: supportsTopPSource },
			maxOutputTokens: { source: maxOutputTokensSource },
			toolCall: { source: toolCallSource },
			modalities: { source: modalitiesSource },
		},
	}
}
