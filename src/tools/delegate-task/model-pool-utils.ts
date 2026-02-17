export type ModelPool = string[]

export type ModelInput = string | ModelPool | undefined

export function isModelPool(model: ModelInput): model is ModelPool {
	return Array.isArray(model)
}

export function normalizeModelToPool(model: ModelInput): ModelPool | undefined {
	if (model === undefined) {
		return undefined
	}
	if (isModelPool(model)) {
		return model
	}
	return [model]
}

export function extractSingleModel(model: ModelInput): string | undefined {
	if (!isModelPool(model)) {
		return model
	}
	if (model.length === 1) {
		return model[0]
	}
	return undefined
}
