import { parseModelString } from "../../tools/delegate-task/model-string-parser"

export function buildRetryModelPayload(
  model: string,
  agentSettings?: { variant?: string; reasoningEffort?: string },
): { model: { providerID: string; modelID: string }; variant?: string; reasoningEffort?: string } | undefined {
  const parsedModel = parseModelString(model)
  if (!parsedModel) {
    return undefined
  }

  const variant = parsedModel.variant ?? agentSettings?.variant
  const reasoningEffort = agentSettings?.reasoningEffort

  const payload: { model: { providerID: string; modelID: string }; variant?: string; reasoningEffort?: string } = {
    model: {
      providerID: parsedModel.providerID,
      modelID: parsedModel.modelID,
    },
  }

  if (variant) {
    payload.variant = variant
  }
  if (reasoningEffort) {
    payload.reasoningEffort = reasoningEffort
  }

  return payload
}
