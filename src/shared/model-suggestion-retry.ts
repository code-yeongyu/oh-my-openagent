import type { createOpencodeClient } from "@opencode-ai/sdk"
import { log } from "./logger"

type Client = ReturnType<typeof createOpencodeClient>

export interface ModelSuggestionInfo {
  providerID: string
  modelID: string
  suggestion: string
}

function extractMessage(error: unknown): string {
  if (typeof error === "string") return error
  if (error instanceof Error) return error.message
  if (typeof error === "object" && error !== null) {
    const obj = error as Record<string, unknown>
    if (typeof obj.message === "string") return obj.message
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
    const errObj = error as Record<string, unknown>

    if (errObj.name === "ProviderModelNotFoundError" && typeof errObj.data === "object" && errObj.data !== null) {
      const data = errObj.data as Record<string, unknown>
      const suggestions = data.suggestions
      if (Array.isArray(suggestions) && suggestions.length > 0 && typeof suggestions[0] === "string") {
        return {
          providerID: String(data.providerID ?? ""),
          modelID: String(data.modelID ?? ""),
          suggestion: suggestions[0],
        }
      }
      return null
    }

    for (const key of ["data", "error", "cause"] as const) {
      const nested = errObj[key]
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

  if (modelMatch && suggestionMatch) {
    return {
      providerID: modelMatch[1].trim(),
      modelID: modelMatch[2].trim(),
      suggestion: suggestionMatch[1].trim(),
    }
  }

  return null
}

interface PromptBody {
  model?: { providerID: string; modelID: string }
  [key: string]: unknown
}

interface PromptArgs {
  path: { id: string }
  body: PromptBody
  [key: string]: unknown
}

export async function promptWithModelSuggestionRetry(
  client: Client,
  args: PromptArgs,
): Promise<void> {
  try {
    await client.session.prompt(args as Parameters<typeof client.session.prompt>[0])
  } catch (error) {
    const suggestion = parseModelSuggestion(error)
    if (!suggestion || !args.body.model) {
      throw error
    }

    log("[model-suggestion-retry] Model not found, retrying with suggestion", {
      original: `${suggestion.providerID}/${suggestion.modelID}`,
      suggested: suggestion.suggestion,
    })

    await client.session.prompt({
      ...args,
      body: {
        ...args.body,
        model: {
          providerID: suggestion.providerID,
          modelID: suggestion.suggestion,
        },
      },
    } as Parameters<typeof client.session.prompt>[0])
  }
}
