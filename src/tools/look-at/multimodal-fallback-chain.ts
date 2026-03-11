import type { FallbackEntry } from "../../shared/model-requirements"
import { AGENT_MODEL_REQUIREMENTS } from "../../shared/model-requirements"
import type { VisionCapableModel } from "../../plugin-state"

const MULTIMODAL_LOOKER_REQUIREMENT = AGENT_MODEL_REQUIREMENTS["multimodal-looker"]

function getFullModelKey(providerID: string, modelID: string): string {
  return `${providerID}/${modelID}`
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
  const entryIndexByKey = new Map<string, number>()
  const fallbackChain: FallbackEntry[] = []

  for (const visionCapableModel of visionCapableModels) {
    const key = getFullModelKey(visionCapableModel.providerID, visionCapableModel.modelID)
    if (entryIndexByKey.has(key)) continue

    entryIndexByKey.set(key, fallbackChain.length)
    fallbackChain.push({
      providers: [visionCapableModel.providerID],
      model: visionCapableModel.modelID,
    })
  }

  for (const entry of MULTIMODAL_LOOKER_REQUIREMENT.fallbackChain) {
    const providerModelKeys = entry.providers.map((providerID) =>
      getFullModelKey(providerID, entry.model),
    )

    const existingIndexes = [...new Set(
      providerModelKeys
        .map((key) => entryIndexByKey.get(key))
        .filter((index): index is number => index !== undefined),
    )]

    if (existingIndexes.length > 0) {
      const [targetIndex, ...duplicateIndexes] = existingIndexes
      const targetEntry = fallbackChain[targetIndex]
      const mergedProviders = new Set(targetEntry.providers)

      for (const providerID of entry.providers) {
        mergedProviders.add(providerID)
      }

      for (const duplicateIndex of duplicateIndexes) {
        const duplicateEntry = fallbackChain[duplicateIndex]
        for (const providerID of duplicateEntry.providers) {
          mergedProviders.add(providerID)
        }
        duplicateEntry.providers = []
      }

      targetEntry.providers = [...mergedProviders]
      targetEntry.variant ??= entry.variant

      for (const providerID of targetEntry.providers) {
        entryIndexByKey.set(getFullModelKey(providerID, targetEntry.model), targetIndex)
      }

      continue
    }

    providerModelKeys.forEach((key) => {
      entryIndexByKey.set(key, fallbackChain.length)
    })
    fallbackChain.push(entry)
  }

  return fallbackChain.filter((entry) => entry.providers.length > 0)
}
