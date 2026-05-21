import type { ModelMetadata } from "../connected-providers-cache"

import type { ModelCapabilities } from "./types"

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readNumber(value: unknown): number | undefined {
	return typeof value === "number" ? value : undefined
}

function readStringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) {
		return undefined
	}

	const strings = value.filter((item): item is string => typeof item === "string")
	return strings.length > 0 ? strings : undefined
}

function normalizeVariantKeys(value: unknown): string[] | undefined {
	const arrayVariants = readStringArray(value)
	if (arrayVariants) {
		return arrayVariants.filter((v): v is string => typeof v === "string").map((variant) => variant.toLowerCase())
	}

	if (!isRecord(value)) {
		return undefined
	}

	const variants = Object.keys(value).map((variant) => variant.toLowerCase())
	return variants.length > 0 ? variants : undefined
}

function readModalityKeys(value: unknown): string[] | undefined {
	const stringArray = readStringArray(value)
	if (stringArray) {
		return stringArray.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.toLowerCase())
	}

	if (!isRecord(value)) {
		return undefined
	}

	// Handle OpenCode's object-shaped modalities: { input: string[], output: string[] }
	// When the full modalities object reaches here (e.g. via the normalizeModalities
	// fallback path), flatten nested string arrays before applying toLowerCase.
	const fromNested = Object.values(value)
		.filter((v): v is string[] => Array.isArray(v))
		.flat()
		.filter((item): item is string => typeof item === "string")
	if (fromNested.length > 0) {
		return fromNested.map((entry) => entry.toLowerCase())
	}

	const enabled = Object.entries(value)
		.filter(([, supported]) => supported === true)
		.map(([modality]) => modality.toLowerCase())

	return enabled.length > 0 ? enabled : undefined
}

function normalizeModalities(value: unknown): ModelCapabilities["modalities"] | undefined {
	if (!isRecord(value)) {
		return undefined
	}

	const input = readModalityKeys(value.input)
	const output = readModalityKeys(value.output)

	if (!input && !output) {
		return undefined
	}

	return {
		...(input ? { input } : {}),
		...(output ? { output } : {}),
	}
}

function readRuntimeModelCapabilities(
	runtimeModel: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
	return isRecord(runtimeModel?.capabilities) ? runtimeModel.capabilities : undefined
}

function readRuntimeModelBoolean(
	runtimeModel: Record<string, unknown> | undefined,
	keys: string[],
): boolean | undefined {
	const runtimeCapabilities = readRuntimeModelCapabilities(runtimeModel)

	for (const key of keys) {
		const value = runtimeModel?.[key]
		if (typeof value === "boolean") {
			return value
		}

		const capabilityValue = runtimeCapabilities?.[key]
		if (typeof capabilityValue === "boolean") {
			return capabilityValue
		}
	}

	return undefined
}

export function readRuntimeModel(
	runtimeModel: ModelMetadata | Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
	return isRecord(runtimeModel) ? runtimeModel : undefined
}

export function readRuntimeModelVariants(
	runtimeModel: Record<string, unknown> | undefined,
): string[] | undefined {
	const rootVariants = normalizeVariantKeys(runtimeModel?.variants)
	if (rootVariants) {
		return rootVariants
	}

	return normalizeVariantKeys(readRuntimeModelCapabilities(runtimeModel)?.variants)
}

export function readRuntimeModelModalities(
	runtimeModel: Record<string, unknown> | undefined,
): ModelCapabilities["modalities"] | undefined {
	const rootModalities = normalizeModalities(runtimeModel?.modalities)
	if (rootModalities) {
		return rootModalities
	}

	const runtimeCapabilities = readRuntimeModelCapabilities(runtimeModel)
	return (
		normalizeModalities(runtimeCapabilities?.modalities)
		?? normalizeModalities(runtimeCapabilities)
	)
}

export function readRuntimeModelReasoningSupport(
	runtimeModel: Record<string, unknown> | undefined,
): boolean | undefined {
	return readRuntimeModelBoolean(runtimeModel, ["reasoning"])
}

export function readRuntimeModelThinkingSupport(
	runtimeModel: Record<string, unknown> | undefined,
): boolean | undefined {
	const capabilityValue = readRuntimeModelReasoningSupport(runtimeModel)
	if (capabilityValue !== undefined) {
		return capabilityValue
	}

	const thinkingSupport = readRuntimeModelBoolean(runtimeModel, ["thinking", "supportsThinking"])
	if (thinkingSupport !== undefined) {
		return thinkingSupport
	}

	const runtimeCapabilities = readRuntimeModelCapabilities(runtimeModel)
	for (const key of ["thinking", "supportsThinking"] as const) {
		const value = runtimeCapabilities?.[key]
		if (typeof value === "boolean") {
			return value
		}
	}

	return undefined
}

export function readRuntimeModelTemperatureSupport(
	runtimeModel: Record<string, unknown> | undefined,
): boolean | undefined {
	return readRuntimeModelBoolean(runtimeModel, ["temperature"])
}

export function readRuntimeModelTopPSupport(
	runtimeModel: Record<string, unknown> | undefined,
): boolean | undefined {
	return readRuntimeModelBoolean(runtimeModel, ["topP", "top_p"])
}

export function readRuntimeModelToolCallSupport(
	runtimeModel: Record<string, unknown> | undefined,
): boolean | undefined {
	return readRuntimeModelBoolean(runtimeModel, ["toolCall", "tool_call", "toolcall"])
}

export function readRuntimeModelLimitOutput(
	runtimeModel: Record<string, unknown> | undefined,
): number | undefined {
	const limit = isRecord(runtimeModel?.limit)
		? runtimeModel.limit
		: readRuntimeModelCapabilities(runtimeModel)?.limit

	if (!isRecord(limit)) {
		return undefined
	}

	const output = readNumber(limit.output)
	// Treat 0 or negative as unknown so ?? fallback to bundled snapshot works
	return output && output > 0 ? output : undefined
}
