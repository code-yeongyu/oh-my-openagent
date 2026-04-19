import { resolveModelPipeline } from "../../shared"
import { transformModelForProvider } from "../../shared/provider-model-id-transform"

function sanitizeOllamaCloudModel(model: string): string {
  const slashIndex = model.indexOf("/")
  if (slashIndex === -1) return model
  const providerID = model.slice(0, slashIndex)
  if (providerID !== "ollama-cloud") return model
  const rawModelID = model.slice(slashIndex + 1)
  if (!rawModelID.endsWith(":cloud")) return model
  return `${providerID}/${rawModelID.slice(0, -6)}`
}

export function applyModelResolution(input: {
  uiSelectedModel?: string
  userModel?: string
  requirement?: { fallbackChain?: { providers: string[]; model: string; variant?: string }[] }
  availableModels: Set<string>
  systemDefaultModel?: string
}) {
  const { uiSelectedModel, userModel, requirement, availableModels, systemDefaultModel } = input
  return resolveModelPipeline({
    intent: { uiSelectedModel, userModel },
    constraints: { availableModels },
    policy: { fallbackChain: requirement?.fallbackChain, systemDefaultModel },
  })
}

export function getFirstFallbackModel(requirement?: {
  fallbackChain?: { providers: string[]; model: string; variant?: string }[]
}) {
  const entry = requirement?.fallbackChain?.[0]
  if (!entry || entry.providers.length === 0) return undefined
  const provider = entry.providers[0]
  const transformedModel = transformModelForProvider(provider, entry.model)
  return {
    model: sanitizeOllamaCloudModel(`${provider}/${transformedModel}`),
    provenance: "provider-fallback" as const,
    variant: entry.variant,
  }
}
