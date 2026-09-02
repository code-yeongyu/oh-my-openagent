import { getFirstAllowedFallbackEntry } from "@oh-my-opencode/model-core"
import { resolveModelPipeline, type FallbackEntry } from "../../shared"
import { transformModelForProvider } from "../../shared/provider-model-id-transform"

export function applyModelResolution(input: {
  uiSelectedModel?: string
  userModel?: string
  requirement?: { fallbackChain?: readonly FallbackEntry[] }
  availableModels: Set<string>
  systemDefaultModel?: string
  disabledProviders?: readonly string[]
}) {
  const { uiSelectedModel, userModel, requirement, availableModels, systemDefaultModel, disabledProviders } = input
  return resolveModelPipeline({
    intent: { uiSelectedModel, userModel },
    constraints: { availableModels, disabledProviders },
    policy: { fallbackChain: requirement?.fallbackChain, systemDefaultModel },
  })
}

export function getFirstFallbackModel(requirement?: {
  fallbackChain?: readonly FallbackEntry[]
}, disabledProviders?: readonly string[]) {
  const fallbackChain = requirement?.fallbackChain
  if (!fallbackChain) return undefined
  const entry = getFirstAllowedFallbackEntry(fallbackChain, disabledProviders)
  if (!entry || entry.providers.length === 0) return undefined
  const provider = entry.providers[0]
  const transformedModel = transformModelForProvider(provider, entry.model)
  return {
    model: `${provider}/${transformedModel}`,
    provenance: "provider-fallback" as const,
    variant: entry.variant,
  }
}
