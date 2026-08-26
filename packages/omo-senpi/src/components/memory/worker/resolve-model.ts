import type { OmoConfig } from "@oh-my-opencode/omo-config-core"
import {
  resolveCategory,
  type SenpiModelPort,
  type SenpiModelRegistryPort,
} from "@oh-my-opencode/senpi-task"

import { chooseReflectionLaunchModel, type ReflectionLaunchCandidate } from "./model-cost"
import { readModelPricing, selectRegistryFallbackModels } from "./registry-fallback"

// Reflection reads a bounded transcript slice, so a fixed workload estimate is enough to compare
// per-token prices. It cancels out while cache reuse is impossible and becomes load-bearing only
// once a cache-replaying launch path exists.
const ESTIMATED_WORKLOAD_TOKENS = 50_000

export type ReflectionThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"

export type ReflectionModelCandidate = {
  readonly model: string
  readonly thinking?: ReflectionThinkingLevel
}

export type ReflectionModelSource = "registry_fallback" | "session_inherit"

export type ReflectionSessionModel = {
  readonly provider: string
  readonly id: string
  readonly thinking?: string
}

export type ReflectionResolveOptions = {
  readonly sessionModel?: ReflectionSessionModel
}

export type ReflectionModelResolution =
  | {
      readonly kind: "resolved"
      readonly category: string
      readonly model: string
      readonly thinking?: ReflectionThinkingLevel
      readonly source?: ReflectionModelSource
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
  options: ReflectionResolveOptions = {},
): ReflectionModelResolution {
  if (!registry) {
    return resolveBeyondCategory(category, undefined, options)
      ?? { kind: "category_unavailable", category, cause: "no_registry" }
  }
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
    // An explicit categories.<name>.disable=true keeps its meaning: no silent fallback model.
    if (resolution.kind !== "disabled") {
      const fallback = resolveBeyondCategory(category, registry, options)
      if (fallback !== undefined) return fallback
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

// Ladder beyond the category chain (Discord report 1537678248337739826): the builtin quick
// chain has no rung for several common single-provider setups, so a dead chain must not kill
// reflection while the runtime registry or the live session still offers a usable model.
function resolveBeyondCategory(
  category: string,
  registry: SenpiModelRegistryPort<SenpiModelPort> | undefined,
  options: ReflectionResolveOptions,
): Extract<ReflectionModelResolution, { readonly kind: "resolved" }> | undefined {
  const candidates = registry === undefined ? [] : selectRegistryFallbackModels(registry.getAvailable())
  const fresh = candidates[0]
  const session = sessionCandidate(options.sessionModel, registry)
  if (fresh === undefined && session === undefined) return undefined

  const decision = chooseReflectionLaunchModel({
    ...(fresh === undefined ? {} : { fresh }),
    ...(session === undefined ? {} : { session }),
    prefixTokens: 0,
    workloadTokens: ESTIMATED_WORKLOAD_TOKENS,
    // The sandboxed reflection child rebuilds its own system prompt, tool list and cwd, so its
    // request prefix never matches the parent session and no provider cache can be replayed.
    cacheReusable: false,
  })
  const thinking = normalizeThinking(decision.thinking)
  return {
    kind: "resolved",
    category,
    model: decision.model,
    ...(thinking === undefined ? {} : { thinking }),
    source: decision.choice === "inherit" ? "session_inherit" : "registry_fallback",
    fallbacks: decision.choice === "inherit" ? [] : candidates.slice(1).map((entry) => ({ model: entry.model })),
  }
}

function sessionCandidate(
  session: ReflectionSessionModel | undefined,
  registry: SenpiModelRegistryPort<SenpiModelPort> | undefined,
): ReflectionLaunchCandidate | undefined {
  if (session === undefined) return undefined
  const cost = registry === undefined ? undefined : readModelPricing(registry.find(session.provider, session.id))
  return {
    model: `${session.provider}/${session.id}`,
    ...(session.thinking === undefined ? {} : { thinking: session.thinking }),
    ...(cost === undefined ? {} : { cost }),
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

  // Every OTHER configured rung is a candidate, not only the rungs below the selected one. The
  // category selects against the availability SNAPSHOT while `find` is the direct lookup that
  // survives a stale snapshot, so an earlier rung skipped at selection time is routinely still
  // usable - and when the snapshot picks the LAST rung (the real-world case) the downstream-only
  // slice left reflection with no fallback at all. Ordering keeps chain priority: continue below
  // the selection first, then wrap to the rungs above it. The child-side preflight probe remains
  // the authority on what the discovery-disabled child can actually see.
  const ordered = [...configured.slice(selectedIndex + 1), ...configured.slice(0, selectedIndex)]

  return ordered.flatMap((entry): readonly ReflectionModelCandidate[] => {
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
