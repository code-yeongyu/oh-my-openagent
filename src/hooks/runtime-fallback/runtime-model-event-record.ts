import { stringifyRuntimeModel, stringifyRuntimeModelWithVariant } from "./fallback-state"

export function resolveRuntimeModelFromEventRecord(
  record: Record<string, unknown> | undefined,
): string | undefined {
  const model = stringifyRuntimeModelWithVariant(record?.model, record?.variant)
  if (model) return model

  return stringifyRuntimeModel({
    providerID: record?.providerID,
    modelID: record?.modelID ?? record?.id,
    variant: record?.variant,
  })
}
