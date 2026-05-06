import type { FallbackEntry } from "../../shared/model-requirements"
import freeModelsSnapshot from "../../generated/free-opencode-models.generated.json"

const FREE_ONLY_PROVIDER_IDS = new Set(freeModelsSnapshot.providers)
const KNOWN_FREE_MODEL_IDS = new Set(freeModelsSnapshot.models)

export const FREE_ONLY_FALLBACK_CHAIN: FallbackEntry[] = freeModelsSnapshot.models.map(
  (model) => ({ providers: freeModelsSnapshot.providers, model }),
)

function getModelId(model: string): string {
  return model.includes("/") ? model.split("/").slice(1).join("/") : model
}

export function isKnownFreeModel(model: string): boolean {
  return KNOWN_FREE_MODEL_IDS.has(getModelId(model))
}

export function isFreeOnlyProviderConfiguration(connectedProviders: string[] | null): boolean {
  return connectedProviders !== null
    && connectedProviders.length > 0
    && connectedProviders.every((provider) => FREE_ONLY_PROVIDER_IDS.has(provider))
}

export function appendFreeModelFallbacks(
  fallbackChain: FallbackEntry[] | undefined,
): FallbackEntry[] {
  if (!fallbackChain || fallbackChain.length === 0) {
    return FREE_ONLY_FALLBACK_CHAIN
  }

  const existingModels = new Set(fallbackChain.map((entry) => entry.model))
  const newEntries = FREE_ONLY_FALLBACK_CHAIN.filter((entry) => !existingModels.has(entry.model))
  return [...fallbackChain, ...newEntries]
}
