import type { FallbackEntry } from "../../shared/model-requirements"
import { normalizeModel } from "../../shared/model-normalization"
import { fuzzyMatchModel } from "../../shared/model-availability"
import { transformModelForProvider } from "../../shared/provider-model-id-transform"
import * as connectedProvidersCache from "../../shared/connected-providers-cache"
import { log } from "../../shared/logger"
import { parseModelString, parseVariantFromModelID } from "../../shared/model-string-parser"
import { filterDisabledProvidersFromFallbackChain, isModelProviderDisabled, isProviderNameDisabled } from "./runtime-model-policy"

function isExplicitHighModel(model: string): boolean {
  return /(?:^|\/)[^/]+-high$/.test(model)
}

function getExplicitHighBaseModel(model: string): string | null {
  return isExplicitHighModel(model) ? model.replace(/-high$/, "") : null
}

function filterAvailableModels(availableModels: Set<string>, disabledProviders: readonly string[] | undefined): Set<string> {
  if (!disabledProviders || disabledProviders.length === 0) return availableModels
  return new Set([...availableModels].filter((model) => !isModelProviderDisabled(model, disabledProviders)))
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
  disabledProviders?: readonly string[]
}): { model: string; variant?: string; fallbackEntry?: FallbackEntry; matchedFallback?: boolean } | { skipped: true } | undefined {
  const disabledProviders = input.disabledProviders
  const availableModels = filterAvailableModels(input.availableModels, disabledProviders)
  const userModel = normalizeModel(input.userModel)
  if (userModel) {
    const parsed = parseUserFallbackModel(userModel)
    const userResult = parsed?.variant
      ? { model: parsed.baseModel, variant: parsed.variant }
      : { model: userModel }

    // When the availability cache is warm AND the user provided fallback_models,
    // verify the user's explicit primary model is actually reachable. If it is
    // not but one of their configured fallback_models is, promote that fallback
    // instead of returning an unreachable model. Cold cache (no availability
    // data yet) preserves the legacy "trust the user" behavior.
    const userFallbackModels = input.userFallbackModels
      ?.filter((fallbackModel) => !isModelProviderDisabled(fallbackModel, disabledProviders))
    if (
      availableModels.size > 0 &&
      userFallbackModels &&
      userFallbackModels.length > 0
    ) {
      const providerHint = parsed?.providerHint
      const primaryMatch = fuzzyMatchModel(userResult.model, availableModels, providerHint)
      if (!primaryMatch) {
        for (const fallbackModel of userFallbackModels) {
          const parsedFallback = parseUserFallbackModel(fallbackModel)
          if (!parsedFallback) continue
          const fbMatch = fuzzyMatchModel(
            parsedFallback.baseModel,
            availableModels,
            parsedFallback.providerHint,
          )
          if (fbMatch) {
            log("[resolveModelForDelegateTask] user primary model unreachable; promoting user fallback_models entry", {
              userPrimary: userResult.model,
              selectedFallback: fbMatch,
            })
            return {
              model: fbMatch,
              variant: parsedFallback.variant,
              matchedFallback: true,
            }
          }
        }
      }
    }

    if (!isModelProviderDisabled(userResult.model, disabledProviders)) {
      return userResult
    }
    return undefined
  }

  const rawConnectedProviders = availableModels.size === 0 ? connectedProvidersCache.readConnectedProvidersCache() : null
  const connectedProviders = rawConnectedProviders
    ? rawConnectedProviders.filter((provider) => !isProviderNameDisabled(provider, disabledProviders))
    : null

  // Before provider cache is created (first run), skip model resolution entirely.
  // OpenCode will use its system default model when no model is specified in the prompt.
  if (
    availableModels.size === 0 &&
    !connectedProvidersCache.hasProviderModelsCache() &&
    !connectedProvidersCache.hasConnectedProvidersCache()
  ) {
    return { skipped: true }
  }

  const categoryDefault = normalizeModel(input.categoryDefaultModel)
  const explicitHighBaseModel = categoryDefault ? getExplicitHighBaseModel(categoryDefault) : null
  const explicitHighModel = explicitHighBaseModel ? categoryDefault : undefined
  if (categoryDefault && !isModelProviderDisabled(categoryDefault, disabledProviders)) {
    if (input.isUserConfiguredCategoryModel) {
      log("[resolveModelForDelegateTask] using user-configured category model (bypass validation)", {
        categoryDefaultModel: categoryDefault,
      })
      const parsed = parseUserFallbackModel(categoryDefault)
      if (parsed?.variant) {
        return { model: parsed.baseModel, variant: parsed.variant }
      }
      return { model: categoryDefault }
    }

    if (availableModels.size === 0) {
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
    const match = fuzzyMatchModel(categoryDefault, availableModels, providerHint)
    if (match) {
      if (isExplicitHighModel(categoryDefault) && match !== categoryDefault) {
        return { model: categoryDefault }
      }

      return { model: match }
    }
  }

  const userFallbackModels = input.userFallbackModels
    ?.filter((fallbackModel) => !isModelProviderDisabled(fallbackModel, disabledProviders))
  if (userFallbackModels && userFallbackModels.length > 0) {
    if (availableModels.size === 0) {
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

        const match = fuzzyMatchModel(parsedFallback.baseModel, availableModels, parsedFallback.providerHint)
        if (match) {
          return { model: match, variant: parsedFallback.variant, matchedFallback: true }
        }
      }
    }
  }

  const fallbackChain = filterDisabledProvidersFromFallbackChain(input.fallbackChain, disabledProviders)
  if (fallbackChain && fallbackChain.length > 0) {
    if (availableModels.size === 0) {
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
          const match = fuzzyMatchModel(fullModel, availableModels, [provider])
          if (match) {
            if (explicitHighModel && entry.variant === "high" && match === explicitHighBaseModel) {
              return { model: explicitHighModel, fallbackEntry: entry, matchedFallback: true }
            }

            return { model: match, variant: entry.variant, fallbackEntry: entry, matchedFallback: true }
          }
        }

        const crossProviderMatch = fuzzyMatchModel(entry.model, availableModels)
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
  if (systemDefaultModel && !isModelProviderDisabled(systemDefaultModel, disabledProviders)) {
    return { model: systemDefaultModel }
  }

  return undefined
}
