export function resolveRunModel(
  modelString?: string
): { providerID: string; modelID: string } | undefined {
  if (modelString === undefined) {
    return undefined
  }

  const trimmed = modelString.trim()
  if (trimmed.length === 0) {
    throw new Error("Model string cannot be empty")
  }

  const parts = trimmed.split("/")
  if (parts.length < 2) {
    throw new Error("Model string must be in 'provider/model' format")
  }

  const providerID = parts[0]
  if (providerID.length === 0) {
    throw new Error("Provider cannot be empty")
  }

  const modelID = parts.slice(1).join("/")
  if (modelID.length === 0) {
    throw new Error("Model ID cannot be empty")
  }

  return { providerID, modelID }
}
