import type { FallbackEntry } from "../../shared/model-requirements"
import { normalizeModel } from "../../shared/model-normalization"
import { fuzzyMatchModel } from "../../shared/model-availability"
import { transformModelForProvider } from "../../shared/provider-model-id-transform"
import { hasConnectedProvidersCache, hasProviderModelsCache } from "../../shared/connected-providers-cache"
import { parseModelString, parseVariantFromModelID } from "./model-string-parser"

function isExplicitHighModel(model: string): boolean {
  return /(?:^|\/)[^/]+-high$/.test(model)
}

function getExplicitHighBaseModel(model: string): string | null {
  return isExplicitHighModel(model) ? model.replace(/-high$/, "") : null
}

function parseUserFallbackModel(fallbackModel: string): {
  baseModel: string
  providerHint?: string[]
  variant?: string
} | undefined {
  const normalizedFallback = normalizeModel(fallbackModel)
  if (!normalizedFallback) {
    return undefined
  }

  const parsedFullModel = parseModelString(normalizedFallback)
  if (parsedFullModel) {
    return {
      baseModel: `${parsedFullModel.providerID}/${parsedFullModel.modelID}`,
      providerHint: [parsedFullModel.providerID],
      variant: parsedFullModel.variant,
    }
  }

  const parsedModel = parseVariantFromModelID(normalizedFallback)
  if (!parsedModel.modelID) {
    return undefined
  }

  return {
    baseModel: parsedModel.modelID,
    variant: parsedModel.variant,
  }
}


export function resolveModelForDelegateTask(input: {
  userModel?: string
  userFallbackModels?: string[]
  categoryDefaultModel?: string
  fallbackChain?: FallbackEntry[]
  availableModels: Set<string>
  systemDefaultModel?: string
}): { model: string; variant?: string } | { skipped: true } | undefined {
  const userModel = normalizeModel(input.userModel)
  if (userModel) {
    return { model: userModel }
  }

  // Before provider cache is created (first run), skip model resolution entirely.
  // OpenCode will use its system default model when no model is specified in the prompt.
  if (input.availableModels.size === 0 && !hasProviderModelsCache() && !hasConnectedProvidersCache()) {
    return { skipped: true }
  }

  const categoryDefault = normalizeModel(input.categoryDefaultModel)
  const explicitHighBaseModel = categoryDefault ? getExplicitHighBaseModel(categoryDefault) : null
  const explicitHighModel = explicitHighBaseModel ? categoryDefault : undefined
  if (categoryDefault) {
    if (input.availableModels.size === 0) {
      return { model: categoryDefault }
    }

    const parts = categoryDefault.split("/")
    const providerHint = parts.length >= 2 ? [parts[0]] : undefined
    const match = fuzzyMatchModel(categoryDefault, input.availableModels, providerHint)
    if (match) {
      if (isExplicitHighModel(categoryDefault) && match !== categoryDefault) {
        return { model: categoryDefault }
      }

      return { model: match }
    }
  }

  const userFallbackModels = input.userFallbackModels
  if (userFallbackModels && userFallbackModels.length > 0) {
    if (input.availableModels.size === 0) {
      const first = userFallbackModels[0] ? parseUserFallbackModel(userFallbackModels[0]) : undefined
      if (first) {
        return { model: first.baseModel, variant: first.variant }
      }
    } else {
      for (const fallbackModel of userFallbackModels) {
        const parsedFallback = parseUserFallbackModel(fallbackModel)
        if (!parsedFallback) continue

        const match = fuzzyMatchModel(parsedFallback.baseModel, input.availableModels, parsedFallback.providerHint)
        if (match) {
          return { model: match, variant: parsedFallback.variant }
        }
      }
    }
  }

  const fallbackChain = input.fallbackChain
  if (fallbackChain && fallbackChain.length > 0) {
    if (input.availableModels.size === 0) {
      const first = fallbackChain[0]
      const provider = first?.providers?.[0]
      if (provider) {
        const transformedModelId = transformModelForProvider(provider, first.model)
        return { model: `${provider}/${transformedModelId}`, variant: first.variant }
      }
    } else {
      for (const entry of fallbackChain) {
        for (const provider of entry.providers) {
          const fullModel = `${provider}/${entry.model}`
          const match = fuzzyMatchModel(fullModel, input.availableModels, [provider])
          if (match) {
            if (explicitHighModel && entry.variant === "high" && match === explicitHighBaseModel) {
              return { model: explicitHighModel }
            }

            return { model: match, variant: entry.variant }
          }
        }

        const crossProviderMatch = fuzzyMatchModel(entry.model, input.availableModels)
        if (crossProviderMatch) {
          if (explicitHighModel && entry.variant === "high" && crossProviderMatch === explicitHighBaseModel) {
            return { model: explicitHighModel }
          }

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
