export interface ParsedModel {
  providerID: string
  modelID: string
}

export function parseModelString(model: string): ParsedModel | null {
  if (!model) {
    return null
  }

  const slashIndex = model.indexOf("/")
  if (slashIndex <= 0) {
    return null
  }

  const providerID = model.substring(0, slashIndex)
  const modelID = model.substring(slashIndex + 1)
  if (!modelID) {
    return null
  }

  return { providerID, modelID }
}
