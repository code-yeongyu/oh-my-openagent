import { splitProvidersAndModel } from "./model-string-parser"

import { fuzzyMatchModel } from "./model-availability"
import type { FallbackEntry } from "./model-requirements"
import { transformModelForProvider } from "./provider-model-id-transform"
import { normalizeModel } from "./model-normalization"
import type { ProviderCache } from "./provider-cache"

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
    const { providers: uiProviders, modelID: uiModelID } = splitProvidersAndModel(normalizedUiModel)
    const normalizedModel = uiProviders.length > 0 && uiModelID ? `${uiProviders[0]}/${uiModelID}` : normalizedUiModel
    log("Model resolved via UI selection", { model: normalizedModel })
    return { model: normalizedModel, provenance: "override" }
  }

  const normalizedUserModel = normalizeModel(intent?.userModel)
  if (normalizedUserModel) {
    const { providers: userProviders, modelID: userModelID } = splitProvidersAndModel(normalizedUserModel)
    const normalizedModel = userProviders.length > 0 && userModelID ? `${userProviders[0]}/${userModelID}` : normalizedUserModel
    log("Model resolved via config override", { model: normalizedModel })
    return { model: normalizedModel, provenance: "override" }
  }

  const normalizedCategoryDefault = normalizeModel(intent?.categoryDefaultModel)
  if (normalizedCategoryDefault) {
    attempted.push(normalizedCategoryDefault)
    if (availableModels.size > 0) {
      const { providers: catProviders, modelID: catModelID } = splitProvidersAndModel(normalizedCategoryDefault)
      const fusedModel = catProviders.length > 0 && catModelID ? `${catProviders[0]}/${catModelID}` : normalizedCategoryDefault
      const providerHint = catProviders.length > 0 ? [catProviders[0]] : undefined
      const match = deps.fuzzyMatchModel(fusedModel, availableModels, providerHint)
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
      const { providers: catProviders, modelID: catModelID } = splitProvidersAndModel(normalizedCategoryDefault)
      if (catProviders.length > 0 && catModelID) {
        const matchedProvider = catProviders.find(p => connectedProviders.includes(p))
        if (matchedProvider) {
          const transformedModel = `${matchedProvider}/${deps.transformModelForProvider(matchedProvider, catModelID)}`
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
      const connectedProviders = constraints.connectedProviders ?? providerCache.readConnectedProvidersCache()
      const connectedSet = connectedProviders ? new Set(connectedProviders) : null

      if (connectedSet !== null) {
        for (const model of userFallbackModels) {
          attempted.push(model)
          const { providers: fbProviders, modelID: fbModelID } = splitProvidersAndModel(model)
          if (fbProviders.length > 0 && fbModelID) {
            const matchedProvider = fbProviders.find(p => connectedSet.has(p))
            if (matchedProvider) {
              const transformedModel = `${matchedProvider}/${deps.transformModelForProvider(matchedProvider, fbModelID)}`
              log("Model resolved via user fallback_models (connected provider)", { model: transformedModel, original: model })
              return { model: transformedModel, provenance: "provider-fallback", attempted }
            }
          }
        }
        log("No connected provider found in user fallback_models, falling through to hardcoded chain")
      }
    } else {
      for (const model of userFallbackModels) {
        attempted.push(model)
        const { providers: fbProviders, modelID: fbModelID } = splitProvidersAndModel(model)
        const providerHint = fbProviders.length > 0 ? [fbProviders[0]] : undefined
        const fusedModel = fbProviders.length > 0 && fbModelID ? `${fbProviders[0]}/${fbModelID}` : model
        const match = deps.fuzzyMatchModel(fusedModel, availableModels, providerHint)
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
          const fullModel = `${provider}/${entry.model}`
          const match = deps.fuzzyMatchModel(fullModel, availableModels, [provider])
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
