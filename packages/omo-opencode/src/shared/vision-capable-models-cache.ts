import type { VisionCapableModel } from "../plugin-state"

let visionCapableModelsCache = new Map<string, VisionCapableModel>()

export function setVisionCapableModelsCache(
  cache: Map<string, VisionCapableModel>,
): void {
  visionCapableModelsCache = cache
}

export function readVisionCapableModelsCache(): VisionCapableModel[] {
  return Array.from(visionCapableModelsCache.values())
}

export function clearVisionCapableModelsCache(): void {
  visionCapableModelsCache = new Map<string, VisionCapableModel>()
}
