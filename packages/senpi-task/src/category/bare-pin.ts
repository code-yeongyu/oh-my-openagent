import { parseVariantFromModelID } from "@oh-my-opencode/model-core"

import type { ModelChainCandidate } from "../model-chain"
import { parseAvailableModels, parseModel } from "./registry-models"
import type { CategoryPinUnserved, SenpiModelPort, SenpiModelRegistryPort } from "./types"

// A bare pin names an exact catalog model id, never a provider-name substring or a similar model.
// Selectors are sorted by parseAvailableModels, so ties choose lexicographic provider/model order.
export function qualifyBareCategoryCandidate(
  candidate: ModelChainCandidate,
  available: ReadonlySet<string>,
): ModelChainCandidate {
  if (candidate.model.includes("/")) return candidate
  const parsed = parseVariantFromModelID(candidate.model)
  const match = [...available].find((selector) => parseModel(selector)?.modelId === parsed.modelID)
  return match === undefined ? candidate : {
    ...candidate,
    model: match,
    ...((candidate.variant ?? parsed.variant) === undefined ? {} : { variant: candidate.variant ?? parsed.variant }),
  }
}

export function unservedBareCategoryPin(
  pin: string | undefined,
  available: ReadonlySet<string>,
  registry: SenpiModelRegistryPort<SenpiModelPort>,
  setting: string,
): CategoryPinUnserved | undefined {
  if (pin === undefined || pin.includes("/") || qualifyBareCategoryCandidate({ model: pin }, available).model !== pin) return undefined
  const modelId = parseVariantFromModelID(pin).modelID
  const catalog = parseAvailableModels(registry.getAll?.()).models
  const providers = [...new Set(catalog.flatMap((selector) => {
    const parsed = parseModel(selector)
    return parsed?.modelId === modelId ? [parsed.provider] : []
  }))]
  return { pin, providers, setting }
}
