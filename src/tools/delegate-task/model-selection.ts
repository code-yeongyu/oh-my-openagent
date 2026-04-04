import type { FallbackEntry } from "../../shared/model-requirements"
import { normalizeModel } from "../../shared/model-normalization"
import { fuzzyMatchModel } from "../../shared/model-availability"
import { transformModelForProvider } from "../../shared/provider-model-id-transform"
import { hasConnectedProvidersCache, hasProviderModelsCache, readConnectedProvidersCache } from "../../shared/connected-providers-cache"
import { log } from "../../shared/logger"
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
  isUserConfiguredCategoryModel?: boolean
  fallbackChain?: FallbackEntry[]
  availableModels: Set<string>
  systemDefaultModel?: string
}): { model: string; variant?: string; fallbackEntry?: FallbackEntry; matchedFallback?: boolean } | { skipped: true } | undefined {
  const userModel = normalizeModel(input.userModel)
  if (userModel) {
    return { model: userModel }
  }

  const connectedProviders = input.availableModels.size === 0 ? readConnectedProvidersCache() : null

  // Before provider cache is created (first run), skip model resolution entirely.
  // OpenCode will use its system default model when no model is specified in the prompt.
  if (input.availableModels.size === 0 && !hasProviderModelsCache() && !hasConnectedProvidersCache()) {
    return { skipped: true }
  }

  const categoryDefault = normalizeModel(input.categoryDefaultModel)
  const explicitHighBaseModel = categoryDefault ? getExplicitHighBaseModel(categoryDefault) : null
  const explicitHighModel = explicitHighBaseModel ? categoryDefault : undefined
  if (categoryDefault) {
    if (input.isUserConfiguredCategoryModel) {
      log("[resolveModelForDelegateTask] using user-configured category model (bypass validation)", {
        categoryDefaultModel: categoryDefault,
      })
      return { model: categoryDefault }
    }

    if (input.availableModels.size === 0) {
      const categoryProvider = categoryDefault.includes("/") ? categoryDefault.split("/")[0] : undefined
      if (!connectedProviders || !categoryProvider || connectedProviders.includes(categoryProvider)) {
        return { model: categoryDefault }
      }

      log("[resolveModelForDelegateTask] skipping disconnected category default on cold cache", {
        categoryDefault,
        connectedProviders,
      })
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
      for (const fallbackModel of userFallbackModels) {
        const parsedFallback = parseUserFallbackModel(fallbackModel)
        if (!parsedFallback) continue

        if (
          connectedProviders &&
          parsedFallback.providerHint &&
          !parsedFallback.providerHint.some((provider) => connectedProviders.includes(provider))
        ) {
          continue
        }

        return { model: parsedFallback.baseModel, variant: parsedFallback.variant, matchedFallback: true }
      }
    } else {
      for (const fallbackModel of userFallbackModels) {
        const parsedFallback = parseUserFallbackModel(fallbackModel)
        if (!parsedFallback) continue

        const match = fuzzyMatchModel(parsedFallback.baseModel, input.availableModels, parsedFallback.providerHint)
        if (match) {
          return { model: match, variant: parsedFallback.variant, matchedFallback: true }
        }
      }
    }
  }

  const fallbackChain = input.fallbackChain
  if (fallbackChain && fallbackChain.length > 0) {
    if (input.availableModels.size === 0) {
      if (connectedProviders) {
        const connectedSet = new Set(connectedProviders)
        for (const entry of fallbackChain) {
          for (const provider of entry.providers) {
            if (connectedSet.has(provider)) {
              const transformedModelId = transformModelForProvider(provider, entry.model)
              log("[resolveModelForDelegateTask] fallback chain resolved via connected provider", {
                provider,
                model: entry.model,
              })
              return { model: `${provider}/${transformedModelId}`, variant: entry.variant, fallbackEntry: entry, matchedFallback: true }
            }
          }
        }
        log("[resolveModelForDelegateTask] no connected provider found in fallback chain")
      } else {
        const first = fallbackChain[0]
        const provider = first?.providers?.[0]
        if (provider) {
          const transformedModelId = transformModelForProvider(provider, first.model)
          return { model: `${provider}/${transformedModelId}`, variant: first.variant, fallbackEntry: first, matchedFallback: true }
        }
      }
    } else {
      for (const entry of fallbackChain) {
        for (const provider of entry.providers) {
          const fullModel = `${provider}/${entry.model}`
          const match = fuzzyMatchModel(fullModel, input.availableModels, [provider])
          if (match) {
            if (explicitHighModel && entry.variant === "high" && match === explicitHighBaseModel) {
              return { model: explicitHighModel, fallbackEntry: entry, matchedFallback: true }
            }

            return { model: match, variant: entry.variant, fallbackEntry: entry, matchedFallback: true }
          }
        }

        const crossProviderMatch = fuzzyMatchModel(entry.model, input.availableModels)
        if (crossProviderMatch) {
          if (explicitHighModel && entry.variant === "high" && crossProviderMatch === explicitHighBaseModel) {
            return { model: explicitHighModel, fallbackEntry: entry, matchedFallback: true }
          }

          return { model: crossProviderMatch, variant: entry.variant, fallbackEntry: entry, matchedFallback: true }
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
