import { normalizeModel } from "./model-normalization"
import { resolveExplicitModel } from "./explicit-model-resolution"
import { parseModelString, parseVariantFromModelID } from "./model-string-parser"

export function resolveExplicitFallbackModel(
  fallbackModel: string,
  input: { availableModels: Set<string> },
): { model: string; variant?: string } | undefined {
  const normalizedFallback = normalizeModel(fallbackModel)
  if (!normalizedFallback) {
    return undefined
  }

  const parsedFullModel = parseModelString(normalizedFallback)
  if (parsedFullModel) {
    const resolvedModel = resolveExplicitModel(
      `${parsedFullModel.providerID}/${parsedFullModel.modelID}`,
      input,
    )
    if (!resolvedModel) {
      return undefined
    }

    return parsedFullModel.variant
      ? { model: resolvedModel, variant: parsedFullModel.variant }
      : { model: resolvedModel }
  }

  const parsedModel = parseVariantFromModelID(normalizedFallback)
  if (!parsedModel.modelID) {
    return undefined
  }

  const resolvedModel = resolveExplicitModel(parsedModel.modelID, input)
  if (!resolvedModel) {
    return undefined
  }

  return parsedModel.variant
    ? { model: resolvedModel, variant: parsedModel.variant }
    : { model: resolvedModel }
}
