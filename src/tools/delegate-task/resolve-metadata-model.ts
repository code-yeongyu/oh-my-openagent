import type { DelegatedModelConfig } from "./types"

export interface MetadataModel {
  providerID: string
  modelID: string
  variant?: string
}

type ModelLike = Pick<DelegatedModelConfig, "providerID" | "modelID" | "variant"> | MetadataModel

function isModelLike(value: unknown): value is ModelLike {
  return typeof value === "object"
    && value !== null
    && "providerID" in value
    && typeof value.providerID === "string"
    && "modelID" in value
    && typeof value.modelID === "string"
}

function toMetadataModel(model: ModelLike): MetadataModel {
  return {
    providerID: model.providerID,
    modelID: model.modelID,
    ...("variant" in model && model.variant ? { variant: model.variant } : {}),
  }
}

export function resolveMetadataModel(
  primary: ModelLike | undefined,
  fallback: ModelLike | undefined,
): MetadataModel | undefined {
  if (isModelLike(primary)) {
    return toMetadataModel(primary)
  }
  if (isModelLike(fallback)) {
    return toMetadataModel(fallback)
  }
  return undefined
}
