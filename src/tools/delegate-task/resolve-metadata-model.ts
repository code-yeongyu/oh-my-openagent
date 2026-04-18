import type { DelegatedModelConfig } from "./types"

export interface MetadataModel {
  providerID: string
  modelID: string
}

type ModelLike = Pick<DelegatedModelConfig, "providerID" | "modelID"> | MetadataModel

export function resolveMetadataModel(
  primary: ModelLike | undefined,
  fallback: ModelLike | undefined,
): MetadataModel | undefined {
  if (primary) {
    return { providerID: primary.providerID, modelID: primary.modelID }
  }
  if (fallback) {
    return { providerID: fallback.providerID, modelID: fallback.modelID }
  }
  return undefined
}
