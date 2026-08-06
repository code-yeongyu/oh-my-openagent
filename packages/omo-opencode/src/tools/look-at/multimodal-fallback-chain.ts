import type { FallbackEntry } from "../../shared/model-requirements"
import { AGENT_MODEL_REQUIREMENTS } from "../../shared/model-requirements"
import type { VisionCapableModel } from "../../plugin-state"

const MULTIMODAL_LOOKER_REQUIREMENT = AGENT_MODEL_REQUIREMENTS["multimodal-looker"]

function getFullModelKey(providerID: string, modelID: string): string {
  return `${providerID}/${modelID}`
}

function findHardcodedFallbackEntry(
  providerID: string,
  modelID: string,
): FallbackEntry | undefined {
  return MULTIMODAL_LOOKER_REQUIREMENT.fallbackChain.find((entry) =>
    entry.model === modelID && entry.providers.includes(providerID),
  )
}

export function isHardcodedMultimodalFallbackModel(model: VisionCapableModel): boolean {
  return MULTIMODAL_LOOKER_REQUIREMENT.fallbackChain.some((entry) =>
    entry.providers.some((providerID) =>
      getFullModelKey(providerID, entry.model) === getFullModelKey(model.providerID, model.modelID),
    ),
  )
}

export function buildMultimodalLookerFallbackChain(
  visionCapableModels: VisionCapableModel[],
): FallbackEntry[] {
  const seen = new Set<string>()
  const fallbackChain: FallbackEntry[] = []

  for (const visionCapableModel of visionCapableModels) {
    const key = getFullModelKey(visionCapableModel.providerID, visionCapableModel.modelID)
    if (seen.has(key)) continue

    const hardcodedEntry = findHardcodedFallbackEntry(
      visionCapableModel.providerID,
      visionCapableModel.modelID,
    )

    seen.add(key)
    fallbackChain.push({
      providers: [visionCapableModel.providerID],
      model: visionCapableModel.modelID,
      ...(hardcodedEntry?.variant ? { variant: hardcodedEntry.variant } : {}),
    })
  }

  for (const entry of MULTIMODAL_LOOKER_REQUIREMENT.fallbackChain) {
    const providerModelKeys = entry.providers.map((providerID) =>
      getFullModelKey(providerID, entry.model),
    )
    if (providerModelKeys.every((key) => seen.has(key))) {
      continue
    }

    providerModelKeys.forEach((key) => {
      seen.add(key)
    })
    fallbackChain.push(entry)
  }

  return fallbackChain
}
