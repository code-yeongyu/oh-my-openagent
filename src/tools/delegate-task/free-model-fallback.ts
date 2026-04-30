import type { FallbackEntry } from "../../shared/model-requirements"

const FREE_ONLY_PROVIDER_IDS = new Set(["opencode"])
const KNOWN_FREE_MODEL_IDS = new Set([
  "big-pickle",
  "gpt-5-nano",
  "hy3-preview-free",
  "minimax-m2.5-free",
  "nemotron-3-super-free",
])

export const FREE_ONLY_FALLBACK_CHAIN: FallbackEntry[] = [
  { providers: ["opencode"], model: "big-pickle" },
  { providers: ["opencode"], model: "minimax-m2.5-free" },
  { providers: ["opencode"], model: "hy3-preview-free" },
  { providers: ["opencode"], model: "nemotron-3-super-free" },
  { providers: ["opencode"], model: "gpt-5-nano" },
]

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

export function getFreeOnlyCategoryDefaultModel(input: {
  categoryDefaultModel?: string
  isUserConfiguredCategoryModel?: boolean
  freeOnlyProviderConfiguration: boolean
}): string | undefined {
  if (!input.freeOnlyProviderConfiguration || input.isUserConfiguredCategoryModel) {
    return input.categoryDefaultModel
  }

  if (!input.categoryDefaultModel || !isKnownFreeModel(input.categoryDefaultModel)) {
    return undefined
  }

  return input.categoryDefaultModel
}

export function getFallbackChainForFreeOnlyProviders(
  fallbackChain: FallbackEntry[] | undefined,
  freeOnlyProviderConfiguration: boolean,
): FallbackEntry[] | undefined {
  if (!freeOnlyProviderConfiguration || !fallbackChain || fallbackChain.length === 0) {
    return fallbackChain
  }

  const freeEntries = fallbackChain.filter((entry) =>
    entry.providers.includes("opencode") && isKnownFreeModel(entry.model),
  )

  return freeEntries.length > 0 ? freeEntries : FREE_ONLY_FALLBACK_CHAIN
}
