export function normalizeEventModel(model: unknown): string | undefined {
  if (typeof model === "string") {
    return model
  }

  if (!model || typeof model !== "object") {
    return undefined
  }

  const modelInfo = model as Record<string, unknown>
  const providerID = modelInfo.providerID
  const modelID = typeof modelInfo.modelID === "string" ? modelInfo.modelID : modelInfo.id
  if (typeof providerID !== "string" || typeof modelID !== "string") {
    return undefined
  }

  const variant = typeof modelInfo.variant === "string" && modelInfo.variant.length > 0
    ? modelInfo.variant
    : undefined

  return `${providerID}/${modelID}${variant ? `(${variant})` : ""}`
}

export function resolveEventModel(props: Record<string, unknown> | undefined): string | undefined {
  return normalizeEventModel(props?.model) ?? normalizeEventModel(props)
}
