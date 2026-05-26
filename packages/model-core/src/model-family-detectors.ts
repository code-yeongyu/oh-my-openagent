function extractModelName(model: string): string {
  return model.includes("/") ? (model.split("/").pop() ?? model) : model
}

export function isGptModel(model: string): boolean {
  const modelName = extractModelName(model).toLowerCase()
  return modelName.includes("gpt")
}

export function isClaudeOpus47Model(model: string): boolean {
  const modelName = extractModelName(model).toLowerCase().replaceAll(".", "-")
  return modelName.includes("claude-opus-4-7")
}

export function isKimiK2Model(model: string): boolean {
  const modelName = extractModelName(model).toLowerCase()
  if (modelName.includes("kimi")) return true
  if (/k2[-.]?p[56]/.test(modelName)) return true
  return false
}

export function isMiniMaxModel(model: string): boolean {
  const modelName = extractModelName(model).toLowerCase()
  return modelName.includes("minimax")
}

export function isGlmModel(model: string): boolean {
  const modelName = extractModelName(model).toLowerCase()
  return modelName.includes("glm")
}

const GEMINI_PROVIDERS = ["google/", "google-vertex/"] as const

export function isGeminiModel(model: string): boolean {
  if (GEMINI_PROVIDERS.some((prefix) => model.startsWith(prefix))) return true

  if (
    model.startsWith("github-copilot/") &&
    extractModelName(model).toLowerCase().startsWith("gemini")
  )
    return true

  const modelName = extractModelName(model).toLowerCase()
  return modelName.startsWith("gemini-")
}
