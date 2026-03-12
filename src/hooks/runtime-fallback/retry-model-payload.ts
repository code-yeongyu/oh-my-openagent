import { parseModelString } from "../../tools/delegate-task/model-string-parser"

export function buildRetryModelPayload(
  model: string,
): { model: { providerID: string; modelID: string }; variant?: string } | undefined {
  const parsedModel = parseModelString(model)
  if (!parsedModel) {
    return undefined
  }

  return parsedModel.variant
    ? {
        model: {
          providerID: parsedModel.providerID,
          modelID: parsedModel.modelID,
        },
        variant: parsedModel.variant,
      }
    : {
        model: {
          providerID: parsedModel.providerID,
          modelID: parsedModel.modelID,
        },
      }
}
