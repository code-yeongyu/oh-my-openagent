import { fuzzyMatchModel } from "./model-availability"
import type { FallbackEntry } from "./model-requirements"
import { transformModelForProvider } from "./provider-model-id-transform"
import { normalizeModel } from "./model-normalization"
import type { ProviderCache } from "./provider-cache"
import { parseModelRoute, type ParsedModelRoute } from "./model-string-parser"

type LogImplementation = (message: string, data?: unknown) => void

let logImplementationForTesting: LogImplementation | undefined

function log(message: string, data?: unknown): void {
  const logImplementation = logImplementationForTesting
  if (!logImplementation) {
    return
  }
  if (arguments.length === 1) {
    logImplementation(message)
    return
  }
  logImplementation(message, data)
}

export function _setModelResolutionLogImplementationForTesting(
  logImplementation: LogImplementation | undefined,
): void {
  logImplementationForTesting = logImplementation
}

export type ModelResolutionRequest = {
  intent?: {
    uiSelectedModel?: string
    userModel?: string
    userFallbackModels?: string[]
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

export type ModelResolutionDeps = {
  fuzzyMatchModel: (
    target: string,
    available: Set<string>,
    providers?: string[],
  ) => string | null
  transformModelForProvider: (provider: string, model: string) => string
}

const DEFAULT_MODEL_RESOLUTION_DEPS: ModelResolutionDeps = {
  fuzzyMatchModel,
  transformModelForProvider,
}

function routeModelForProvider(provider: string, modelID: string, deps: ModelResolutionDeps): string {
  return `${provider}/${deps.transformModelForProvider(provider, modelID)}`
}

function rawRouteModelForProvider(provider: string, modelID: string): string {
  return `${provider}/${modelID}`
}

function matchProviderModelInAvailableModels(
  provider: string,
  modelID: string,
  availableModels: Set<string>,
  deps: ModelResolutionDeps,
): string | null {
  const rawModel = rawRouteModelForProvider(provider, modelID)
  const rawMatch = deps.fuzzyMatchModel(rawModel, availableModels, [provider])
  if (rawMatch) return rawMatch

  const transformedModel = routeModelForProvider(provider, modelID, deps)
  if (transformedModel === rawModel) return null
  return deps.fuzzyMatchModel(transformedModel, availableModels, [provider])
}

function matchRouteInAvailableModels(route: ParsedModelRoute, availableModels: Set<string>, deps: ModelResolutionDeps): string | null {
  for (const provider of route.providers) {
    const match = matchProviderModelInAvailableModels(provider, route.modelID, availableModels, deps)
    if (match) return match
  }
  return null
}

function resolveRouteForConnectedProvider(route: ParsedModelRoute, connectedSet: Set<string>, deps: ModelResolutionDeps): string | undefined {
  for (const provider of route.providers) {
    if (connectedSet.has(provider)) {
      return routeModelForProvider(provider, route.modelID, deps)
    }
  }
  return undefined
}

export function resolveModelPipeline(
  request: ModelResolutionRequest,
  providerCache: ProviderCache = {
    readConnectedProvidersCache: () => null,
    findProviderModelMetadata: () => undefined,
  },
  deps: ModelResolutionDeps = DEFAULT_MODEL_RESOLUTION_DEPS,
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
    const categoryRoute = parseModelRoute(normalizedCategoryDefault)
    if (availableModels.size > 0) {
      const match = categoryRoute
        ? matchRouteInAvailableModels(categoryRoute, availableModels, deps)
        : deps.fuzzyMatchModel(normalizedCategoryDefault, availableModels)
      if (match) {
        log("Model resolved via category default (fuzzy matched)", {
          original: normalizedCategoryDefault,
          matched: match,
        })
        return { model: match, provenance: "category-default", attempted }
      }
    } else {
      const connectedProviders = constraints.connectedProviders ?? providerCache.readConnectedProvidersCache()
      if (connectedProviders === null) {
        log("Model resolved via category default (no cache, first run)", {
          model: normalizedCategoryDefault,
        })
        return { model: normalizedCategoryDefault, provenance: "category-default", attempted }
      }
      const connectedSet = new Set(connectedProviders)
      const transformedModel = categoryRoute
        ? resolveRouteForConnectedProvider(categoryRoute, connectedSet, deps)
        : undefined
      if (transformedModel) {
        log("Model resolved via category default (connected provider)", {
          model: transformedModel,
          original: normalizedCategoryDefault,
        })
        return { model: transformedModel, provenance: "category-default", attempted }
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
      const connectedProviders = constraints.connectedProviders ?? providerCache.readConnectedProvidersCache()
      const connectedSet = connectedProviders ? new Set(connectedProviders) : null

      if (connectedSet !== null) {
        for (const model of userFallbackModels) {
          attempted.push(model)
          const route = parseModelRoute(model)
          if (!route) continue
          const transformedModel = resolveRouteForConnectedProvider(route, connectedSet, deps)
          if (transformedModel) {
            log("Model resolved via user fallback_models (connected provider)", { model: transformedModel, original: model })
            return { model: transformedModel, provenance: "provider-fallback", attempted }
          }
        }
        log("No connected provider found in user fallback_models, falling through to hardcoded chain")
      }
    } else {
      for (const model of userFallbackModels) {
        attempted.push(model)
        const route = parseModelRoute(model)
        if (!route) continue
        const match = matchRouteInAvailableModels(route, availableModels, deps)
        if (match) {
          log("Model resolved via user fallback_models (availability confirmed)", { model: model, match })
          return { model: match, provenance: "provider-fallback", attempted }
        }
      }
      log("No available model found in user fallback_models, falling through to hardcoded chain")
    }
  }

  if (fallbackChain && fallbackChain.length > 0) {
    if (availableModels.size === 0) {
      const connectedProviders = constraints.connectedProviders ?? providerCache.readConnectedProvidersCache()
      const connectedSet = connectedProviders ? new Set(connectedProviders) : null

      if (connectedSet === null) {
        log("Model fallback chain skipped (no connected providers cache) - falling through to system default")
      } else {
        for (const entry of fallbackChain) {
          for (const provider of entry.providers) {
            if (connectedSet.has(provider)) {
              const transformedModelId = deps.transformModelForProvider(provider, entry.model)
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
          const match = matchProviderModelInAvailableModels(provider, entry.model, availableModels, deps)
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
