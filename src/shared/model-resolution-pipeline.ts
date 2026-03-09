import { log } from "./logger"
import * as connectedProvidersCache from "./connected-providers-cache"
import { fuzzyMatchModel } from "./model-availability"
import type { FallbackEntry } from "./model-requirements"
import { transformModelForProvider } from "./provider-model-id-transform"
import { normalizeModel } from "./model-normalization"

export type ModelResolutionRequest = {
  intent?: {
    uiSelectedModel?: string
    userModel?: string
    userVariant?: string
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
    profileName?: string
    agentName?: string
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


export function resolveModelPipeline(
  request: ModelResolutionRequest,
): ModelResolutionResult | undefined {
  const attempted: string[] = []
  const { intent, constraints, policy } = request
  const availableModels = constraints.availableModels
  const fallbackChain = policy?.fallbackChain
  const systemDefaultModel = policy?.systemDefaultModel
  const agentPrefix = policy?.agentName ? `Agent ${policy.agentName} ` : ""

  const normalizedUiModel = normalizeModel(intent?.uiSelectedModel)
  if (normalizedUiModel) {
    log(`[model-resolution] ${agentPrefix}resolved to ${normalizedUiModel} via uiSelected override`)
    return { model: normalizedUiModel, provenance: "override", reason: "UI-selected model override" }
  }

  const normalizedUserModel = normalizeModel(intent?.userModel)
  if (normalizedUserModel) {
    log(`[model-resolution] ${agentPrefix}resolved to ${normalizedUserModel} via userModel override`)
    return { model: normalizedUserModel, provenance: "override", variant: intent?.userVariant, reason: "User-configured model override" }
  }

  const normalizedCategoryDefault = normalizeModel(intent?.categoryDefaultModel)
  if (normalizedCategoryDefault) {
    attempted.push(normalizedCategoryDefault)
    if (availableModels.size > 0) {
      const parts = normalizedCategoryDefault.split("/")
      const providerHint = parts.length >= 2 ? [parts[0]] : undefined
      const match = fuzzyMatchModel(normalizedCategoryDefault, availableModels, providerHint)
      if (match) {
        log(`[model-resolution] ${agentPrefix}category-default: ` + match)
        return { model: match, provenance: "category-default", attempted, reason: "Category default model (fuzzy matched)" }
      }
    } else {
      const connectedProviders = constraints.connectedProviders ?? connectedProvidersCache.readConnectedProvidersCache()
      if (connectedProviders === null) {
        log(`[model-resolution] ${agentPrefix}category-default: ` + normalizedCategoryDefault)
        return { model: normalizedCategoryDefault, provenance: "category-default", attempted, reason: "Category default model (no provider cache)" }
      }
      const parts = normalizedCategoryDefault.split("/")
      if (parts.length >= 2) {
        const provider = parts[0]
         if (connectedProviders.includes(provider)) {
           const modelName = parts.slice(1).join("/")
           const transformedModel = `${provider}/${transformModelForProvider(provider, modelName)}`
           log(`[model-resolution] ${agentPrefix}category-default: ` + transformedModel)
           return { model: transformedModel, provenance: "category-default", attempted, reason: "Category default model (connected provider)" }
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
          attempted.push(model)
          const parts = model.split("/")
          if (parts.length >= 2) {
            const provider = parts[0]
             if (connectedSet.has(provider)) {
               const modelName = parts.slice(1).join("/")
               const transformedModel = `${provider}/${transformModelForProvider(provider, modelName)}`
               log(`[model-resolution] ${agentPrefix}provider-fallback: ` + transformedModel + " (tried: " + attempted.join(", ") + ")")
               return { model: transformedModel, provenance: "provider-fallback", attempted, reason: "User fallback model (connected provider)" }
             }
          }
        }
        log("No connected provider found in user fallback_models, falling through to hardcoded chain")
      }
    } else {
      for (const model of userFallbackModels) {
        attempted.push(model)
        const parts = model.split("/")
        const providerHint = parts.length >= 2 ? [parts[0]] : undefined
         const match = fuzzyMatchModel(model, availableModels, providerHint)
         if (match) {
           log(`[model-resolution] ${agentPrefix}provider-fallback: ` + match + " (tried: " + attempted.join(", ") + ")")
           return { model: match, provenance: "provider-fallback", attempted, reason: "User fallback model (availability confirmed)" }
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
               log(`[model-resolution] ${agentPrefix}provider-fallback: ` + model + " (tried: " + attempted.join(", ") + ")")
               return {
                 model,
                 provenance: "provider-fallback",
                 variant: entry.variant,
                 attempted,
                 reason: "Fallback chain model (connected provider)",
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
             log(`[model-resolution] ${agentPrefix}provider-fallback: ` + match + " (tried: " + attempted.join(", ") + ")")
             return {
               model: match,
               provenance: "provider-fallback",
               variant: entry.variant,
               attempted,
               reason: "Fallback chain model (availability confirmed)",
             }
           }
        }

         const crossProviderMatch = fuzzyMatchModel(entry.model, availableModels)
         if (crossProviderMatch) {
           log(`[model-resolution] ${agentPrefix}provider-fallback: ` + crossProviderMatch + " (tried: " + attempted.join(", ") + ")")
           return {
             model: crossProviderMatch,
             provenance: "provider-fallback",
             variant: entry.variant,
             attempted,
             reason: "Fallback chain model (cross-provider fuzzy match)",
           }
         }
      }
      log("No available model found in fallback chain, falling through to system default")
    }
  }

  if (systemDefaultModel === undefined) {
    log(`[model-resolution] ${agentPrefix}no model resolved - systemDefaultModel not configured`)
    return undefined
  }

  log(`[model-resolution] ${agentPrefix}system-default: ` + systemDefaultModel)
  return { model: systemDefaultModel, provenance: "system-default", attempted, reason: "System default model (ultimate fallback)" }
}
