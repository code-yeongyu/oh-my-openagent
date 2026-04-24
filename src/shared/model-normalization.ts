import { transformModelForProvider } from "./provider-model-id-transform"

const LEGACY_GATEWAY_PREFIX = "gateway/"

function normalizeLegacyGatewayAlias(model: string): string {
	if (!model.startsWith(LEGACY_GATEWAY_PREFIX)) {
		return model
	}

	const legacyModel = model.slice(LEGACY_GATEWAY_PREFIX.length)
	return `vercel/${transformModelForProvider("vercel", legacyModel)}`
}

export function normalizeModel(model?: string): string | undefined {
	const trimmed = model?.trim()
	if (!trimmed) {
		return undefined
	}

	return normalizeLegacyGatewayAlias(trimmed)
}

export function normalizeModelID(modelID: string): string {
	return modelID.replace(/\.(\d+)/g, "-$1")
}
