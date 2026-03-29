import { log } from "./logger"
import * as connectedProvidersCache from "./connected-providers-cache"
import { fuzzyMatchModel } from "./model-availability"
import type { FallbackEntry } from "./model-requirements"
import { transformModelForProvider } from "./provider-model-id-transform"
import { normalizeModel } from "./model-normalization"
import { resolveExplicitModel } from "./explicit-model-resolution"
import { resolveExplicitFallbackModel } from "./explicit-fallback-model-resolution"
import type { FallbackModelObject } from "../config/schema/fallback-models"
import { parseModelString, parseVariantFromModelID } from "./model-string-parser"

export type ModelResolutionRequest = {
  intent?: {
    uiSelectedModel?: string
    userModel?: string
    userFallbackModels?: (string | FallbackModelObject)[]
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

function parseConfiguredFallbackModel(
  fallbackModel: string | FallbackModelObject,
): { baseModel: string; providerHint?: string[]; variant?: string } | undefined {
  const configuredModel = typeof fallbackModel === "string" ? fallbackModel : fallbackModel.model
  const normalizedFallback = normalizeModel(configuredModel)
  if (!normalizedFallback) {
    return undefined
  }

  const parsedFullModel = parseModelString(normalizedFallback)
  if (parsedFullModel) {
    return {
      baseModel: `${parsedFullModel.providerID}/${parsedFullModel.modelID}`,
      providerHint: [parsedFullModel.providerID],
      variant: typeof fallbackModel === "string"
        ? parsedFullModel.variant
        : fallbackModel.variant ?? parsedFullModel.variant,
    }
  }

  const parsedModel = parseVariantFromModelID(normalizedFallback)
  if (!parsedModel.modelID) {
    return undefined
  }

  return {
    baseModel: parsedModel.modelID,
    variant: typeof fallbackModel === "string"
      ? parsedModel.variant
      : fallbackModel.variant ?? parsedModel.variant,
  }
}


export function resolveModelPipeline(
  request: ModelResolutionRequest,
): ModelResolutionResult | undefined {
  const attempted: string[] = []
  const { intent, constraints, policy } = request
  const availableModels = constraints.availableModels
  const fallbackChain = policy?.fallbackChain
  const systemDefaultModel = policy?.systemDefaultModel

  const resolvedUiModel = resolveExplicitModel(intent?.uiSelectedModel, { availableModels })
  if (resolvedUiModel) {
    log("Model resolved via UI selection", { model: resolvedUiModel })
    return { model: resolvedUiModel, provenance: "override" }
  }

  const resolvedUserModel = resolveExplicitModel(intent?.userModel, { availableModels })
  if (resolvedUserModel) {
    log("Model resolved via config override", { model: resolvedUserModel })
    return { model: resolvedUserModel, provenance: "override" }
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
          const modelName = parts.slice(1).join("/")
          const transformedModel = `${provider}/${transformModelForProvider(provider, modelName)}`
          log("Model resolved via category default (connected provider)", {
            model: transformedModel,
            original: normalizedCategoryDefault,
          })
          return { model: transformedModel, provenance: "category-default", attempted }
        }
      }
    }
    log("Category default model not available, falling through to fallback chain", {
      model: normalizedCategoryDefault,
    })
  }

  //#when - user configured fallback_models, try them before hardcoded fallback chain
  const userFallbackModels = intent?.userFallbackModels
  if (userFallbackModels && userFallbackModels.length > 0) {
    if (availableModels.size === 0) {
      const connectedProviders = constraints.connectedProviders ?? connectedProvidersCache.readConnectedProvidersCache()
      const connectedSet = connectedProviders ? new Set(connectedProviders) : null

      if (connectedSet !== null) {
        for (const model of userFallbackModels) {
          attempted.push(typeof model === "string" ? model : model.model)
          const parsedFallback = parseConfiguredFallbackModel(model)
          if (!parsedFallback) {
            continue
          }

          if (parsedFallback.providerHint?.some((provider) => connectedSet.has(provider))) {
              log("Model resolved via user fallback_models (connected provider)", {
                model: parsedFallback.baseModel,
                original: typeof model === "string" ? model : model.model,
              })
              return {
                model: parsedFallback.baseModel,
                provenance: "provider-fallback",
                attempted,
                ...(parsedFallback.variant ? { variant: parsedFallback.variant } : {}),
              }
          }
        }
        log("No connected provider found in user fallback_models, falling through to hardcoded chain")
      }
    } else {
      for (const model of userFallbackModels) {
        attempted.push(typeof model === "string" ? model : model.model)
        if (typeof model === "string") {
          const resolvedFallback = resolveExplicitFallbackModel(model, { availableModels })
          if (!resolvedFallback) {
            continue
          }

          log("Model resolved via user fallback_models (availability confirmed)", {
            model: resolvedFallback.model,
            original: model,
          })
          return {
            model: resolvedFallback.model,
            provenance: "provider-fallback",
            attempted,
            ...(resolvedFallback.variant ? { variant: resolvedFallback.variant } : {}),
          }
        }

        const parsedFallback = parseConfiguredFallbackModel(model)
        if (!parsedFallback) {
          continue
        }

        const match = fuzzyMatchModel(
          parsedFallback.baseModel,
          availableModels,
          parsedFallback.providerHint,
        )
        if (!match) {
          continue
        }

        log("Model resolved via user fallback_models (availability confirmed)", {
          model: match,
          original: model.model,
        })
        return {
          model: match,
          provenance: "provider-fallback",
          attempted,
          ...(parsedFallback.variant ? { variant: parsedFallback.variant } : {}),
        }
      }
      log("No available model found in user fallback_models, falling through to hardcoded chain")
    }
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
              const transformedModelId = transformModelForProvider(provider, entry.model)
              const model = `${provider}/${transformedModelId}`
              log("Model resolved via fallback chain (connected provider)", {
                provider,
                model: transformedModelId,
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
