export function normalizeModelFormat(
  model: string | { providerID: string; modelID: string }
): { providerID: string; modelID: string } | undefined {
  if (!model) {
    return undefined
  }

  if (typeof model === "object" && "providerID" in model && "modelID" in model) {
    return { providerID: model.providerID, modelID: model.modelID }
  }

  if (typeof model === "string") {
    const parts = model.split("/")
    if (parts.length >= 2) {
      return { providerID: parts[0], modelID: parts.slice(1).join("/") }
    }
  }

  return undefined
}
