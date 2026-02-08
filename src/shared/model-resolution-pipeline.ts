import { log } from "./logger"
import * as connectedProvidersCache from "./connected-providers-cache"
import { fuzzyMatchModel } from "./model-availability"
import type { FallbackEntry } from "./model-requirements"

export type ModelResolutionRequest = {
  intent?: {
    uiSelectedModel?: string
    userModel?: string
    categoryDefaultModel?: string
  }
  constraints: {
    availableModels: Set<string>
    connectedProviders?: string[] | null
  }
  policy?: {
    fallbackChain?: FallbackEntry[]
    systemDefaultModel?: string
  }
}

export type ModelResolutionProvenance =
  | "override"
  | "category-default"
  | "provider-fallback"
  | "system-default"

export type ModelResolutionResult = {
  model: string
  provenance: ModelResolutionProvenance
  variant?: string
  attempted?: string[]
  reason?: string
}

function normalizeModel(model?: string): string | undefined {
  const trimmed = model?.trim()
  return trimmed || undefined
}

export function resolveModelPipeline(
  request: ModelResolutionRequest,
): ModelResolutionResult | undefined {
  const attempted: string[] = []
  const { intent, constraints, policy } = request
  const availableModels = constraints.availableModels
  const fallbackChain = policy?.fallbackChain
  const systemDefaultModel = policy?.systemDefaultModel

  const normalizedUiModel = normalizeModel(intent?.uiSelectedModel)
  if (normalizedUiModel) {
    log("Model resolved via UI selection", { model: normalizedUiModel })
    return { model: normalizedUiModel, provenance: "override" }
  }

  const normalizedUserModel = normalizeModel(intent?.userModel)
  if (normalizedUserModel) {
    log("Model resolved via config override", { model: normalizedUserModel })
    return { model: normalizedUserModel, provenance: "override" }
  }

  const normalizedCategoryDefault = normalizeModel(intent?.categoryDefaultModel)
  if (normalizedCategoryDefault) {
    attempted.push(normalizedCategoryDefault)
    if (availableModels.size > 0) {
      const parts = normalizedCategoryDefault.split("/")
      const providerHint = parts.length >= 2 ? [parts[0]] : undefined
      const match = fuzzyMatchModel(normalizedCategoryDefault, availableModels, providerHint)
      if (match) {
        log("Model resolved via category default (fuzzy matched)", {
          original: normalizedCategoryDefault,
          matched: match,
        })
        return { model: match, provenance: "category-default", attempted }
      }
    } else {
      const connectedProviders = constraints.connectedProviders ?? connectedProvidersCache.readConnectedProvidersCache()
      if (connectedProviders === null) {
        log("Model resolved via category default (no cache, first run)", {
          model: normalizedCategoryDefault,
        })
        return { model: normalizedCategoryDefault, provenance: "category-default", attempted }
      }
      const parts = normalizedCategoryDefault.split("/")
      if (parts.length >= 2) {
        const provider = parts[0]
        if (connectedProviders.includes(provider)) {
          log("Model resolved via category default (connected provider)", {
            model: normalizedCategoryDefault,
          })
          return { model: normalizedCategoryDefault, provenance: "category-default", attempted }
        }
      }
    }
    log("Category default model not available, falling through to fallback chain", {
      model: normalizedCategoryDefault,
    })
  }

  if (fallbackChain && fallbackChain.length > 0) {
    if (availableModels.size === 0) {
      const connectedProviders = constraints.connectedProviders ?? connectedProvidersCache.readConnectedProvidersCache()
      const connectedSet = connectedProviders ? new Set(connectedProviders) : null

      if (connectedSet === null) {
        log("Model fallback chain skipped (no connected providers cache) - falling through to system default")
      } else {
        for (const entry of fallbackChain) {
          for (const provider of entry.providers) {
            if (connectedSet.has(provider)) {
              const model = `${provider}/${entry.model}`
              log("Model resolved via fallback chain (connected provider)", {
                provider,
                model: entry.model,
                variant: entry.variant,
              })
              return {
                model,
                provenance: "provider-fallback",
                variant: entry.variant,
                attempted,
              }
            }
          }
        }
        log("No connected provider found in fallback chain, falling through to system default")
      }
    } else {
      for (const entry of fallbackChain) {
        for (const provider of entry.providers) {
          const fullModel = `${provider}/${entry.model}`
          const match = fuzzyMatchModel(fullModel, availableModels, [provider])
          if (match) {
            log("Model resolved via fallback chain (availability confirmed)", {
              provider,
              model: entry.model,
              match,
              variant: entry.variant,
            })
            return {
              model: match,
              provenance: "provider-fallback",
              variant: entry.variant,
              attempted,
            }
          }
        }

        const crossProviderMatch = fuzzyMatchModel(entry.model, availableModels)
        if (crossProviderMatch) {
          log("Model resolved via fallback chain (cross-provider fuzzy match)", {
            model: entry.model,
            match: crossProviderMatch,
            variant: entry.variant,
          })
          return {
            model: crossProviderMatch,
            provenance: "provider-fallback",
            variant: entry.variant,
            attempted,
          }
        }
      }
      log("No available model found in fallback chain, falling through to system default")
    }
  }

  if (systemDefaultModel === undefined) {
    log("No model resolved - systemDefaultModel not configured")
    return undefined
  }

  log("Model resolved via system default", { model: systemDefaultModel })
  return { model: systemDefaultModel, provenance: "system-default", attempted }
}
