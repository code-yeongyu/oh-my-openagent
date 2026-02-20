/**
 * Parse a model string in "provider/model" format.
 */
export function parseModelString(model: string): { providerID: string; modelID: string } | undefined {
  if (!model || !model.trim()) {
    return undefined
  }

  const slashIndex = model.indexOf("/")
  if (slashIndex <= 0) {
    return undefined
  }

  const providerID = model.substring(0, slashIndex).trim()
  const modelID = model.substring(slashIndex + 1).trim()

  if (!providerID || !modelID) {
    return undefined
  }

  return { providerID, modelID }
}
