import { splitProvidersAndModel } from "./model-string-parser"

export function normalizeModelFormat(
  model: string | { providerID: string; modelID: string } | null | undefined
): { providerID: string; modelID: string } | undefined {
  if (!model) {
    return undefined
  }

  if (typeof model === "object" && "providerID" in model && "modelID" in model) {
    return { providerID: model.providerID, modelID: model.modelID }
  }

  if (typeof model === "string") {
    const { providers, modelID } = splitProvidersAndModel(model)
    if (providers.length > 0 && modelID) {
      return { providerID: providers[0], modelID }
    }
  }

  return undefined
}
