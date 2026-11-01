import type { OmoConfig } from "@oh-my-opencode/omo-config-core"
import {
  builtinCategoryChainCandidates,
  resolveCategory,
  withoutExcludedModels,
  type SenpiModelPort,
  type SenpiModelRegistryPort,
} from "@oh-my-opencode/senpi-task"

import { selectRegistryFallbackModels } from "./registry-fallback"

export type ReflectionThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"

export type ReflectionModelCandidate = {
  readonly model: string
  readonly thinking?: ReflectionThinkingLevel
  /** Set by the preflight when only an extension-loading child can see the model (#9175). */
  readonly loadExtensions?: true
}

export type ReflectionModelSource = "registry_fallback"

export type ReflectionSessionModel = {
  readonly provider: string
  readonly id: string
  readonly thinking?: string
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
      /** Each designated rung the category tried, and why it could not serve the run. */
      readonly attempts?: readonly ReflectionModelAttempt[]
      readonly missingProviders?: readonly string[]
    }

export type ReflectionModelAttempt = {
  readonly model: string
  readonly why: "provider_not_connected" | "model_unavailable"
}

const THINKING_LEVELS: readonly ReflectionThinkingLevel[] = [
  "off", "minimal", "low", "medium", "high", "xhigh", "max",
]

export function resolveReflectionModel(
  category: string,
  config: OmoConfig,
  liveRegistry: SenpiModelRegistryPort<SenpiModelPort> | undefined,
): ReflectionModelResolution {
  // exclude_models reaches every rung below: the category chain, a pin, the builtin rungs appended
  // after it and the beyond-category ladder all read this one filtered view.
  const registry = liveRegistry === undefined ? undefined : withoutExcludedModels(liveRegistry, config.exclude_models)
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
        return { kind: "resolved", category, model: pinnedSelector, fallbacks: builtinChainFallbacks(category, registry, pinnedSelector) }
      }
    }
    // An explicit categories.<name>.disable=true keeps its meaning: no silent fallback model.
    if (resolution.kind !== "disabled") {
      const fallback = resolveBeyondCategory(category, registry)
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
        ? { attempts: chainAttempts(resolution.attempted_chain, resolution.missing_providers ?? []) }
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
  const selectedModel = `${resolution.spec.provider}/${resolution.spec.modelId}`
  const fallbacks = deduplicateCandidates([
    ...resolvedFallbacks,
    ...configuredFallbacks,
    ...builtinChainFallbacks(category, registry, selectedModel),
  ])
  return {
    kind: "resolved",
    category: resolution.category,
    model: `${resolution.spec.provider}/${resolution.spec.modelId}`,
    ...(thinking === undefined ? {} : { thinking }),
    fallbacks,
  }
}

// Ladder beyond the category chain (Discord report 1537678248337739826): the builtin quick
// chain has no rung for several common single-provider setups, so a dead chain falls to the
// cheapest connected registry model. The parent session's model is never a rung here (#12081):
// with no registry candidate the run fails typed instead of inheriting the session model.
function resolveBeyondCategory(
  category: string,
  registry: SenpiModelRegistryPort<SenpiModelPort>,
): Extract<ReflectionModelResolution, { readonly kind: "resolved" }> | undefined {
  const [first, ...rest] = selectRegistryFallbackModels(registry.getAvailable())
  if (first === undefined) return undefined
  return {
    kind: "resolved",
    category,
    model: first.model,
    source: "registry_fallback",
    fallbacks: rest.map((entry) => ({ model: entry.model })),
  }
}

// A memory child has nobody to answer a refused model: a user pin outside the category's builtin
// chain (`resolveCategory` leaves such a pin's chain untouched) would leave it with no rung at all,
// so a provider that refuses the pin (Devin answers an unserved lane with permission_denied) fails
// every wake. The builtin chain's connected rungs stay reachable after the user's own rungs; they
// are the category's chain, never the beyond-category ladder the advisor refuses.
function builtinChainFallbacks(
  category: string,
  registry: SenpiModelRegistryPort<SenpiModelPort>,
  selectedModel: string,
): readonly ReflectionModelCandidate[] {
  return builtinCategoryChainCandidates(category, registry).flatMap((candidate): readonly ReflectionModelCandidate[] => {
    if (candidate.model === selectedModel) return []
    const thinking = normalizeThinking(candidate.variant)
    return [{ model: candidate.model, ...(thinking === undefined ? {} : { thinking }) }]
  })
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

function chainAttempts(
  chain: readonly { readonly providers: readonly string[]; readonly model: string }[],
  missingProviders: readonly string[],
): readonly ReflectionModelAttempt[] {
  const missing = new Set(missingProviders)
  return chain.flatMap((rung) => rung.providers.map((provider): ReflectionModelAttempt => ({
    model: `${provider}/${rung.model}`,
    why: missing.has(provider) ? "provider_not_connected" : "model_unavailable",
  })))
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
