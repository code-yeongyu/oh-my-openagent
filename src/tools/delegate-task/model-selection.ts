import type { FallbackEntry } from "../../shared/model-requirements"
import { fuzzyMatchModel, isModelAvailable } from "../../shared/model-availability"
import { getNextModel } from "./model-pool-state"
import { isModelPool } from "./model-pool-utils"

function normalizeModel(model: unknown): string | undefined {
  if (typeof model !== "string") {
    return undefined
  }
  const trimmed = model.trim()
  return trimmed || undefined
}

export function resolveModelForDelegateTask(input: {
  userModel?: string
  categoryDefaultModel?: string | string[] | undefined
  fallbackChain?: FallbackEntry[]
  availableModels: Set<string>
  systemDefaultModel?: string
}): { model: string; variant?: string } | undefined {
  const userModel = normalizeModel(input.userModel)
  if (userModel) {
    return { model: userModel }
  }

  if (isModelPool(input.categoryDefaultModel)) {
    const pool = input.categoryDefaultModel
    if (pool.length > 0) {
      const poolKey = JSON.stringify(pool)

      if (input.availableModels.size === 0) {
        const candidateModel = normalizeModel(getNextModel(poolKey, pool))
        if (candidateModel) {
          return { model: candidateModel }
        }
      } else {
        const maxAttempts = pool.length
        for (let i = 0; i < maxAttempts; i++) {
          const candidateModel = normalizeModel(getNextModel(poolKey, pool))
          if (!candidateModel) {
            continue
          }
          if (isModelAvailable(candidateModel, input.availableModels)) {
            return { model: candidateModel }
          }
        }
      }
    }
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
