import { resolveModelIDAlias } from "../model-capability-aliases"
import { detectHeuristicModelFamily } from "../model-capability-heuristics"

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

function hasRuntimeCapabilityEvidence(sources: {
	variants: ModelCapabilitiesDiagnostics["variants"]["source"]
	reasoning: ModelCapabilitiesDiagnostics["reasoning"]["source"]
	supportsThinking: ModelCapabilitiesDiagnostics["supportsThinking"]["source"]
	supportsTemperature: ModelCapabilitiesDiagnostics["supportsTemperature"]["source"]
	supportsTopP: ModelCapabilitiesDiagnostics["supportsTopP"]["source"]
	maxOutputTokens: ModelCapabilitiesDiagnostics["maxOutputTokens"]["source"]
	toolCall: ModelCapabilitiesDiagnostics["toolCall"]["source"]
	modalities: ModelCapabilitiesDiagnostics["modalities"]["source"]
}): boolean {
	return Object.values(sources).some((source) => source === "runtime")
}

export function getModelCapabilities(input: GetModelCapabilitiesInput): ModelCapabilities {
	const canonicalization = resolveModelIDAlias(input.modelID, input.providerID)
	const override = getOverride(input.modelID)
	const providerOverride = getProviderOverride(input.providerID, canonicalization.canonicalModelID)
	const runtimeModel = readRuntimeModel(
		input.runtimeModel ?? input.providerCache?.findProviderModelMetadata(input.providerID, input.modelID),
	)
	const runtimeSnapshot = input.runtimeSnapshot
	const bundledSnapshot = input.bundledSnapshot
	const snapshotEntry = runtimeSnapshot?.models?.[canonicalization.canonicalModelID]
		?? bundledSnapshot?.models?.[canonicalization.canonicalModelID]
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
		runtimeSnapshot?.models?.[canonicalization.canonicalModelID]
			? "runtime-snapshot"
			: bundledSnapshot?.models?.[canonicalization.canonicalModelID]
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
	const runtimeCapabilityBacked = hasRuntimeCapabilityEvidence({
		variants: variantsSource,
		reasoning: reasoningSource,
		supportsThinking: supportsThinkingSource,
		supportsTemperature: supportsTemperatureSource,
		supportsTopP: supportsTopPSource,
		maxOutputTokens: maxOutputTokensSource,
		toolCall: toolCallSource,
		modalities: modalitiesSource,
	})
	const resolutionMode: ModelCapabilitiesDiagnostics["resolutionMode"] =
		snapshotSource !== "none" && canonicalization.source === "canonical"
			? "snapshot-backed"
		: snapshotSource !== "none"
			? "alias-backed"
		: familySource === "heuristic" || variantsSource === "heuristic" || reasoningEffortsSource === "heuristic"
			? "heuristic-backed"
		: runtimeCapabilityBacked
			? "runtime-backed"
			: "unknown"

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
