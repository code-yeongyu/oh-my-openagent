import type { OmoConfig } from "@oh-my-opencode/omo-config-core"
import {
  resolveCategory,
  type SenpiModelPort,
  type SenpiModelRegistryPort,
} from "@oh-my-opencode/senpi-task"

export type ReflectionThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"

export type ReflectionModelResolution =
  | {
      readonly kind: "resolved"
      readonly category: string
      readonly model: string
      readonly thinking?: ReflectionThinkingLevel
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
        return { kind: "resolved", category, model: pinnedSelector }
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
  return {
    kind: "resolved",
    category: resolution.category,
    model: `${resolution.spec.provider}/${resolution.spec.modelId}`,
    ...(thinking === undefined ? {} : { thinking }),
  }
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
