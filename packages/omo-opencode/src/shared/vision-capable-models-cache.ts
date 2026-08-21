import type { VisionCapableModel } from "../plugin-state"

let visionCapableModelsCache = new Map<string, VisionCapableModel>()
let textOnlyModelsCache = new Map<string, VisionCapableModel>()

export function setVisionCapableModelsCache(
  cache: Map<string, VisionCapableModel>,
): void {
  visionCapableModelsCache = cache
}

export function readVisionCapableModelsCache(): VisionCapableModel[] {
  return Array.from(visionCapableModelsCache.values())
}

export function setTextOnlyModelsCache(
  models: Iterable<VisionCapableModel>,
): void {
  textOnlyModelsCache = new Map(
    Array.from(models, (model) => [
      `${model.providerID}/${model.modelID}`,
      model,
    ]),
  )
}

export function readTextOnlyModelsCache(): VisionCapableModel[] {
  return Array.from(textOnlyModelsCache.values())
}

export function clearVisionCapableModelsCache(): void {
  visionCapableModelsCache = new Map<string, VisionCapableModel>()
  textOnlyModelsCache = new Map<string, VisionCapableModel>()
}
