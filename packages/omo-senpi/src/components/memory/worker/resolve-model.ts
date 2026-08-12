import type { OmoConfig } from "@oh-my-opencode/omo-config-core"
import {
  resolveCategory,
  type SenpiModelPort,
  type SenpiModelRegistryPort,
} from "@oh-my-opencode/senpi-task"

export type ReflectionThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"

export type ReflectionModelCandidate = {
  readonly model: string
  readonly thinking?: ReflectionThinkingLevel
}

export type ReflectionModelResolution =
  | {
      readonly kind: "resolved"
      readonly category: string
      readonly model: string
      readonly thinking?: ReflectionThinkingLevel
      readonly fallbacks: readonly ReflectionModelCandidate[]
    }
  | {
      readonly kind: "category_unavailable"
      readonly category: string
      readonly cause: "no_registry" | "not_found" | "model_unavailable" | "unknown"
      readonly attemptedChain?: readonly unknown[]
      readonly missingProviders?: readonly string[]
    }

const THINKING_LEVELS: readonly ReflectionThinkingLevel[] = [
  "off", "minimal", "low", "medium", "high", "xhigh", "max",
]

export function resolveReflectionModel(
  category: string,
  config: OmoConfig,
  registry: SenpiModelRegistryPort<SenpiModelPort> | undefined,
): ReflectionModelResolution {
  if (!registry) return { kind: "category_unavailable", category, cause: "no_registry" }
  const resolution = resolveCategory(category, config, registry)
  if (resolution.kind !== "resolved") {
    const pinned = config.categories?.[category]?.model
    const pinnedSelector = typeof pinned === "string" && pinned.includes("/") ? pinned : undefined
    if (resolution.kind === "model_unavailable" && pinnedSelector !== undefined) {
      const [provider, modelId] = pinnedSelector.split("/", 2)
      const found = registry.find(provider, modelId)
      if (found !== undefined) {
        // An explicitly pinned user model is authoritative over the availability snapshot, which
        // is refreshed asynchronously and is routinely stale when a first-turn (step_count=1)
        // reflection triggers before extension-provider registration finishes refreshing.
        return { kind: "resolved", category, model: pinnedSelector, fallbacks: [] }
      }
    }
    return {
      kind: "category_unavailable",
      category,
      cause:
        resolution.kind === "not_found"
          ? "not_found"
          : resolution.kind === "model_unavailable"
            ? "model_unavailable"
            : "unknown",
      ...(resolution.kind === "model_unavailable" && resolution.attempted_chain !== undefined
        ? { attemptedChain: resolution.attempted_chain }
        : {}),
      ...(resolution.kind === "model_unavailable" && resolution.missing_providers !== undefined
        ? { missingProviders: resolution.missing_providers }
        : {}),
    }
  }

  const rawThinking = resolution.spec.reasoning
    ?? resolution.spec.reasoningEffort
    ?? resolution.spec.variant
  const thinking = normalizeThinking(rawThinking)
  const resolvedFallbacks = (resolution.spec.fallback_models ?? []).map((fallback): ReflectionModelCandidate => {
    const fallbackThinking = normalizeThinking(fallback.reasoning_effort ?? fallback.variant)
    return {
      model: `${fallback.provider}/${fallback.model_id}`,
      ...(fallbackThinking === undefined ? {} : { thinking: fallbackThinking }),
    }
  })
  const configuredFallbacks = configuredFallbackModels(
    category,
    config,
    registry,
    `${resolution.spec.provider}/${resolution.spec.modelId}`,
  )
  const fallbacks = deduplicateCandidates([...resolvedFallbacks, ...configuredFallbacks])
  return {
    kind: "resolved",
    category: resolution.category,
    model: `${resolution.spec.provider}/${resolution.spec.modelId}`,
    ...(thinking === undefined ? {} : { thinking }),
    fallbacks,
  }
}

function configuredFallbackModels(
  category: string,
  config: OmoConfig,
  registry: SenpiModelRegistryPort<SenpiModelPort>,
  selectedModel: string,
): readonly ReflectionModelCandidate[] {
  const categoryConfig = config.categories?.[category]
  if (categoryConfig === undefined) return []
  const canonical = categoryConfig.models
  const legacy = categoryConfig.fallback_models
  const configured = canonical !== undefined && canonical.length > 0
    ? canonical
    : legacy === undefined
      ? []
      : [selectedModel, ...(Array.isArray(legacy) ? legacy : [legacy])]
  if (configured.length === 0) return []
  const selectedIndex = configured.findIndex((entry) =>
    (typeof entry === "string" ? entry : entry.model) === selectedModel
  )
  if (selectedIndex === -1) return []

  return configured.slice(selectedIndex + 1).flatMap((entry): readonly ReflectionModelCandidate[] => {
    const selector = typeof entry === "string" ? entry : entry.model
    const separatorIndex = selector.indexOf("/")
    if (separatorIndex <= 0 || separatorIndex === selector.length - 1) return []
    const provider = selector.slice(0, separatorIndex)
    const modelId = selector.slice(separatorIndex + 1)
    if (registry.find(provider, modelId) === undefined) return []
    const rawThinking = typeof entry === "string"
      ? undefined
      : entry.reasoning ?? entry.reasoningEffort ?? entry.variant
    const thinking = normalizeThinking(rawThinking)
    return [{
      model: selector,
      ...(thinking === undefined ? {} : { thinking }),
    }]
  })
}

function deduplicateCandidates(
  candidates: readonly ReflectionModelCandidate[],
): readonly ReflectionModelCandidate[] {
  const seen = new Set<string>()
  return candidates.filter((candidate) => {
    if (seen.has(candidate.model)) return false
    seen.add(candidate.model)
    return true
  })
}

export function shouldWarnCategoryUnavailable(config: OmoConfig, category: string): boolean {
  if (config.categories?.[category]?.model !== undefined) return false
  return (config.categories?.[category]?.warn_unavailable
    ?? config.task?.warnings.unavailable_categories
    ?? true) !== false
}

function normalizeThinking(value: string | undefined): ReflectionThinkingLevel | undefined {
  if (value === undefined || value === "auto") return undefined
  const normalized = value === "none" ? "off" : value
  return THINKING_LEVELS.includes(normalized as ReflectionThinkingLevel)
    ? normalized as ReflectionThinkingLevel
    : undefined
}
