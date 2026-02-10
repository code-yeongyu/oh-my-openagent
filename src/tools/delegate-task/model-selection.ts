import type { FallbackEntry } from "../../shared/model-requirements"
import { fuzzyMatchModel } from "../../shared/model-availability"

function normalizeModel(model?: string): string | undefined {
  const trimmed = model?.trim()
  return trimmed || undefined
}

export function resolveModelForDelegateTask(input: {
  userModel?: string
  categoryDefaultModel?: string
  fallbackChain?: FallbackEntry[]
  availableModels: Set<string>
  systemDefaultModel?: string
}): { model: string; variant?: string } | undefined {
  const userModel = normalizeModel(input.userModel)
  if (userModel) {
    return { model: userModel }
  }

  const categoryDefault = normalizeModel(input.categoryDefaultModel)
  if (categoryDefault) {
    if (input.availableModels.size === 0) {
      return { model: categoryDefault }
    }

    const parts = categoryDefault.split("/")
    const providerHint = parts.length >= 2 ? [parts[0]] : undefined
    const match = fuzzyMatchModel(categoryDefault, input.availableModels, providerHint)
    if (match) {
      return { model: match }
    }
  }

  const fallbackChain = input.fallbackChain
  if (fallbackChain && fallbackChain.length > 0) {
    if (input.availableModels.size === 0) {
      const first = fallbackChain[0]
      const provider = first?.providers?.[0]
      if (provider) {
        return { model: `${provider}/${first.model}`, variant: first.variant }
      }
    } else {
      for (const entry of fallbackChain) {
        for (const provider of entry.providers) {
          const fullModel = `${provider}/${entry.model}`
          const match = fuzzyMatchModel(fullModel, input.availableModels, [provider])
          if (match) {
            return { model: match, variant: entry.variant }
          }
        }

        const crossProviderMatch = fuzzyMatchModel(entry.model, input.availableModels)
        if (crossProviderMatch) {
          return { model: crossProviderMatch, variant: entry.variant }
        }
      }
    }
  }

  const systemDefaultModel = normalizeModel(input.systemDefaultModel)
  if (systemDefaultModel) {
    return { model: systemDefaultModel }
  }

  return undefined
}
