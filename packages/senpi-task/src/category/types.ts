import type { DelegateFallbackEntry } from "@oh-my-opencode/delegate-core"
import type { OmoCategoryConfig } from "@oh-my-opencode/omo-config-core"

export type BuiltinCategoryDefinition = {
  readonly name: string
  readonly config: OmoCategoryConfig
  readonly description: string
  readonly promptAppend: string
  readonly resolvePromptAppend?: (model: string | undefined) => string
}

export type SenpiModelPort = {
  readonly provider: string
  readonly id: string
}

export type SenpiModelRegistryPort<TModel extends SenpiModelPort> = {
  readonly getAvailable: () => readonly TModel[] | unknown
  readonly find: (provider: string, modelId: string) => TModel | unknown
}

export type ResolvedChildSpec<TModel extends SenpiModelPort> = {
  readonly model: TModel
  readonly provider: string
  readonly modelId: string
  readonly displayName?: string
  readonly variant?: string
  readonly temperature?: number
  readonly top_p?: number
  readonly maxTokens?: number
  readonly thinking?: OmoCategoryConfig["thinking"]
  readonly reasoningEffort?: OmoCategoryConfig["reasoningEffort"]
  readonly tools?: OmoCategoryConfig["tools"]
  readonly prompt_append?: string
}

export type ResolveCategoryOptions = {
  readonly systemDefaultModel?: string
}

export type CategoryModelSelection = {
  readonly selectedModel: string
  readonly variant?: string
  readonly matchedFallback: boolean
  readonly fallbackEntry?: DelegateFallbackEntry
}

export type CategoryResolutionResult<TModel extends SenpiModelPort> =
  | {
      readonly kind: "resolved"
      readonly category: string
      readonly spec: ResolvedChildSpec<TModel>
      readonly config: OmoCategoryConfig
      readonly description?: string
      readonly modelSelection: CategoryModelSelection
      readonly availableCategories: readonly string[]
    }
  | {
      readonly kind: "disabled"
      readonly category: string
      readonly reason: string
      readonly availableCategories: readonly string[]
    }
  | {
      readonly kind: "not_found"
      readonly category: string
      readonly availableCategories: readonly string[]
    }
  | {
      readonly kind: "model_unavailable"
      readonly category: string
      readonly attemptedModel: string | undefined
      readonly availableModels: readonly string[]
      readonly availableCategories: readonly string[]
      readonly nearestFallback?: string
      readonly fallbackEntry?: DelegateFallbackEntry
    }
