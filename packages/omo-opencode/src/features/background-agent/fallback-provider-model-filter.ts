import type { ModelMetadata } from "../../shared/connected-providers-cache"

function canonicalizeModelID(modelID: string): string {
  return modelID.toLowerCase().replace(/\./g, "-")
}

function providerListsModel(providerModels: string[] | ModelMetadata[], modelID: string): boolean {
  const wanted = canonicalizeModelID(modelID)
  return providerModels.some((entry) => {
    const id = typeof entry === "string" ? entry : entry.id
    return canonicalizeModelID(id) === wanted
  })
}

/**
 * Drops connected providers whose cached model list is known and does not contain the model.
 * Providers without a cached model list are kept, so an incomplete cache never blocks a fallback.
 */
export function filterProvidersServingModel(args: {
  providers: string[]
  model: string
  connectedSet: Set<string> | null
  modelsByProvider: Record<string, string[] | ModelMetadata[]> | undefined
  transformModelForProvider: (providerID: string, model: string) => string
}): string[] {
  const { providers, model, connectedSet, modelsByProvider, transformModelForProvider } = args
  if (!connectedSet || !modelsByProvider) return providers

  return providers.filter((provider) => {
    if (!connectedSet.has(provider.toLowerCase())) return true
    const providerModels = modelsByProvider[provider]
    if (!providerModels || providerModels.length === 0) return true
    return providerListsModel(providerModels, transformModelForProvider(provider, model))
  })
}
