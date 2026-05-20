export function normalizeModel(model?: string): string | undefined {
	const trimmed = model?.trim()
	return trimmed || undefined
}

export function normalizeModelID(modelID: string): string {
	return modelID.replace(/\.(\d+)/g, "-$1")
}
