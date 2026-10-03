import { fuzzyMatchModel, parseVariantFromModelID } from "@oh-my-opencode/model-core"

/**
 * The provider-qualified form of a bare model id (`deepseek-v4-flash`, optionally with a reasoning
 * suffix): the model as served by the first connected provider, in the given order, whose catalog
 * matches it - the meaning a bare id has in model profiles and in `fallback_models` (#9503). A
 * qualified id, or a bare id no provider in `available` serves, is returned unchanged.
 */
export function qualifyBareModel(model: string, available: readonly string[]): string {
  const trimmed = model.trim()
  if (trimmed.includes("/")) return model
  const { modelID } = parseVariantFromModelID(trimmed)
  if (modelID.length === 0) return model
  const match = fuzzyMatchModel(modelID, new Set(available))
  if (match === null) return model
  return `${match}${trimmed.startsWith(modelID) ? trimmed.slice(modelID.length) : ""}`
}
