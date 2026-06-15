import { splitProvidersAndModel } from "../../shared/model-string-parser"

export function resolveRunModel(
  modelString?: string
): { providerID: string; modelID: string } | undefined {
  if (modelString === undefined) {
    return undefined
  }

  const trimmed = modelString.trim()
  if (trimmed.length === 0) {
    throw new Error("Model string cannot be empty")
  }

  const { providers, modelID } = splitProvidersAndModel(trimmed)
  if (providers.length === 0 || !modelID) {
    throw new Error("Model string must be in 'provider/model' or 'provider1|provider2/name' format")
  }

  return { providerID: providers[0], modelID }
}
