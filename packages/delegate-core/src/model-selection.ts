import {
  fuzzyMatchModel,
  normalizeModel,
  parseModelString,
  parseVariantFromModelID,
  transformModelForProvider,
} from "@oh-my-opencode/model-core"

export type DelegateFallbackEntry = {
  readonly providers: string[]
  readonly model: string
  readonly variant?: string
}

export type DelegateModelResolutionInput = {
  readonly userModel?: string
  readonly userFallbackModels?: readonly string[]
  readonly categoryDefaultModel?: string
  readonly isUserConfiguredCategoryModel?: boolean
  readonly fallbackChain?: readonly DelegateFallbackEntry[]
  readonly availableModels: ReadonlySet<string>
  readonly systemDefaultModel?: string
}

export type DelegateModelResolutionResult =
  | { readonly model: string; readonly variant?: string; readonly fallbackEntry?: DelegateFallbackEntry; readonly matchedFallback?: boolean }
  | { readonly skipped: true }
  | undefined

export type DelegateModelResolutionDeps = {
  readonly connectedProviders: readonly string[] | null
  readonly hasProviderModelsCache: boolean
  readonly hasConnectedProvidersCache: boolean
  readonly log?: (message: string, metadata?: Record<string, unknown>) => void
}

function isExplicitHighModel(model: string): boolean {
  return /(?:^|\/)[^/]+-high$/.test(model)
}

function getExplicitHighBaseModel(model: string): string | null {
  return isExplicitHighModel(model) ? model.replace(/-high$/, "") : null
}

function parseUserFallbackModel(fallbackModel: string): {
  readonly baseModel: string
  readonly providerHint?: string[]
  readonly variant?: string
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

export function resolveModelForDelegateTask(
  input: DelegateModelResolutionInput,
  deps: DelegateModelResolutionDeps,
): DelegateModelResolutionResult {
  const userModel = normalizeModel(input.userModel)
  if (userModel) {
    const parsed = parseUserFallbackModel(userModel)
    const userResult = parsed?.variant
      ? { model: parsed.baseModel, variant: parsed.variant }
      : { model: userModel }

    const userFallbackModels = input.userFallbackModels
    if (
      input.availableModels.size > 0 &&
      userFallbackModels &&
      userFallbackModels.length > 0
    ) {
      const providerHint = parsed?.providerHint
      const primaryMatch = fuzzyMatchModel(userResult.model, new Set(input.availableModels), providerHint)
      if (!primaryMatch) {
        for (const fallbackModel of userFallbackModels) {
          const parsedFallback = parseUserFallbackModel(fallbackModel)
          if (!parsedFallback) continue
          const fbMatch = fuzzyMatchModel(
            parsedFallback.baseModel,
            new Set(input.availableModels),
            parsedFallback.providerHint,
          )
          if (fbMatch) {
            deps.log?.("[resolveModelForDelegateTask] user primary model unreachable; promoting user fallback_models entry", {
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

    return userResult
  }

  const connectedProviders = input.availableModels.size === 0 ? deps.connectedProviders : null

  if (
    input.availableModels.size === 0 &&
    connectedProviders === null &&
    !deps.hasProviderModelsCache &&
    !deps.hasConnectedProvidersCache
  ) {
    return { skipped: true }
  }

  const categoryDefault = normalizeModel(input.categoryDefaultModel)
  const explicitHighBaseModel = categoryDefault ? getExplicitHighBaseModel(categoryDefault) : null
  const explicitHighModel = explicitHighBaseModel ? categoryDefault : undefined
  if (categoryDefault) {
    if (input.isUserConfiguredCategoryModel) {
      deps.log?.("[resolveModelForDelegateTask] using user-configured category model (bypass validation)", {
        categoryDefaultModel: categoryDefault,
      })
      const parsed = parseUserFallbackModel(categoryDefault)
      if (parsed?.variant) {
        return { model: parsed.baseModel, variant: parsed.variant }
      }
      return { model: categoryDefault }
    }

    if (input.availableModels.size === 0) {
      const categoryProvider = categoryDefault.includes("/") ? categoryDefault.split("/")[0] : undefined
      if (!connectedProviders || !categoryProvider || connectedProviders.includes(categoryProvider)) {
        return { model: categoryDefault }
      }

      deps.log?.("[resolveModelForDelegateTask] skipping disconnected category default on cold cache", {
        categoryDefault,
        connectedProviders,
      })
    }

    const parts = categoryDefault.split("/")
    const providerHint = parts.length >= 2 && parts[0] ? [parts[0]] : undefined
    const match = fuzzyMatchModel(categoryDefault, new Set(input.availableModels), providerHint)
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

        const match = fuzzyMatchModel(parsedFallback.baseModel, new Set(input.availableModels), parsedFallback.providerHint)
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
              deps.log?.("[resolveModelForDelegateTask] fallback chain resolved via connected provider", {
                provider,
                model: entry.model,
              })
              return { model: `${provider}/${transformedModelId}`, variant: entry.variant, fallbackEntry: entry, matchedFallback: true }
            }
          }
        }
        deps.log?.("[resolveModelForDelegateTask] no connected provider found in fallback chain")
      } else {
        const first = fallbackChain[0]
        const provider = first?.providers?.[0]
        if (first && provider) {
          const transformedModelId = transformModelForProvider(provider, first.model)
          return { model: `${provider}/${transformedModelId}`, variant: first.variant, fallbackEntry: first, matchedFallback: true }
        }
      }
    } else {
      for (const entry of fallbackChain) {
        for (const provider of entry.providers) {
          const fullModel = `${provider}/${entry.model}`
          const match = fuzzyMatchModel(fullModel, new Set(input.availableModels), [provider])
          if (match) {
            if (explicitHighModel && entry.variant === "high" && match === explicitHighBaseModel) {
              return { model: explicitHighModel, fallbackEntry: entry, matchedFallback: true }
            }

            return { model: match, variant: entry.variant, fallbackEntry: entry, matchedFallback: true }
          }
        }

        const crossProviderMatch = fuzzyMatchModel(entry.model, new Set(input.availableModels))
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
