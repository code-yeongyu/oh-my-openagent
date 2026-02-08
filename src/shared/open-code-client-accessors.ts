import type { ModelListFunction, ProviderListFunction } from "./open-code-client-shapes"
import { isRecord } from "./record-type-guard"

export function getProviderListFunction(client: unknown): ProviderListFunction | null {
	if (!isRecord(client)) return null
	const provider = client["provider"]
	if (!isRecord(provider)) return null
	const list = provider["list"]
	if (typeof list !== "function") return null
	return list as ProviderListFunction
}

export function getModelListFunction(client: unknown): ModelListFunction | null {
	if (!isRecord(client)) return null
	const model = client["model"]
	if (!isRecord(model)) return null
	const list = model["list"]
	if (typeof list !== "function") return null
	return list as ModelListFunction
}
