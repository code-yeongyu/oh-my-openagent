const DEPRECATED_MODEL_REMAP: Record<string, string> = {
	"claude-3-5-haiku-20241022": "claude-haiku-4-5",
	"claude-3-5-haiku-latest": "claude-haiku-4-5",
	"claude-haiku-3-5": "claude-haiku-4-5",
	"haiku-3.5": "claude-haiku-4-5",
	"haiku": "claude-haiku-4-5",
}

const DEFAULT_PROVIDER_FOR_REMAP = "anthropic"

function remapDeprecatedModel(model: string): string {
	const trimmed = model.trim()
	if (trimmed.length === 0) return trimmed

	const segments = trimmed.split("/")
	const hasProvider = segments.length > 1
	const provider = hasProvider ? segments[0] : undefined
	const modelId = hasProvider ? segments.slice(1).join("/") : segments[0]
	const replacement = DEPRECATED_MODEL_REMAP[modelId.toLowerCase()]
	if (!replacement) {
		return trimmed
	}

	const targetProvider = provider || DEFAULT_PROVIDER_FOR_REMAP
	return `${targetProvider}/${replacement}`
}

export function normalizeModel(model?: string): string | undefined {
	const trimmed = model?.trim()
	if (!trimmed) return undefined
	return remapDeprecatedModel(trimmed)
}

export function normalizeModelID(modelID: string): string {
	return modelID.replace(/\.(\d+)/g, "-$1")
}
