export interface ModelSuggestionInfo {
  providerID: string
  modelID: string
  suggestion: string
}

function readProperty(value: unknown, key: PropertyKey): unknown {
  if (typeof value !== "object" || value === null) return undefined
  if (!(key in value)) return undefined
  return Reflect.get(value, key)
}

function extractMessage(error: unknown): string {
  if (typeof error === "string") return error
  if (error instanceof Error) return error.message
  if (typeof error === "object" && error !== null) {
    const message = readProperty(error, "message")
    if (typeof message === "string") return message
    try {
      return JSON.stringify(error)
    } catch {
      return ""
    }
  }
  return String(error)
}

export function parseModelSuggestion(error: unknown): ModelSuggestionInfo | null {
  if (!error) return null

  if (typeof error === "object") {
    if (readProperty(error, "name") === "ProviderModelNotFoundError") {
      const data = readProperty(error, "data")
      const suggestions = readProperty(data, "suggestions")
      if (typeof data === "object" && data !== null && Array.isArray(suggestions) && typeof suggestions[0] === "string") {
        return {
          providerID: String(readProperty(data, "providerID") ?? ""),
          modelID: String(readProperty(data, "modelID") ?? ""),
          suggestion: suggestions[0],
        }
      }
      return null
    }

    for (const key of ["data", "error", "cause"] as const) {
      const nested = readProperty(error, key)
      if (nested && typeof nested === "object") {
        const result = parseModelSuggestion(nested)
        if (result) return result
      }
    }
  }

  const message = extractMessage(error)
  if (!message) return null

  const modelMatch = message.match(/model not found:\s*([^/\s]+)\s*\/\s*([^.\s]+)/i)
  const suggestionMatch = message.match(/did you mean:\s*([^,?]+)/i)

  const providerID = modelMatch?.[1]
  const modelID = modelMatch?.[2]
  const suggestion = suggestionMatch?.[1]
  if (!providerID || !modelID || !suggestion) return null

  return {
    providerID: providerID.trim(),
    modelID: modelID.trim(),
    suggestion: suggestion.trim(),
  }
}
