import {
  OPENAI_ONLY_RECOMMENDED_MODEL_IDS,
  type OpenAiOnlyRecommendation,
} from "@oh-my-opencode/delegate-core"

import { isSafeSenpiModel, ownStringDataProperty } from "./model-registry-boundary"
import type { SenpiModelPort, SenpiModelRegistryPort } from "./types"

// Compiles the maintained OpenAI-only recommendation overlay against the authenticated live model
// registry at resolution time (issue #6813). A recommendation applies ONLY when:
// 1. the target has no explicit user entry (callers guarantee this),
// 2. the inventory is safely identified as OpenAI-only, and
// 3. the exact recommended model exists in the registry.
//
// Identity rules: a registry model is openai-identified when its provider id is `openai`, or when
// the registry exposes `getUpstreamModelId` and that EXPLICIT upstream mapping equals a known
// recommended OpenAI model id. An OpenAI-compatible wire protocol alone is never treated as OpenAI
// identity, and a registry that cannot parse cleanly never qualifies (fail closed).

export type OpenAiOnlyOverlayTarget = {
  readonly provider: string
  readonly modelId: string
}

export type OpenAiOnlyOverlay = {
  readonly recommendation: OpenAiOnlyRecommendation
  readonly target: OpenAiOnlyOverlayTarget
}

type ParsedInventoryEntry<TModel extends SenpiModelPort> = {
  readonly provider: string
  readonly modelId: string
  readonly model: TModel
}

// Mirrors the safe registry parsing of category/resolver.ts: only own string data properties count.
// Fail closed on the WHOLE inventory, never per entry: skipping a malformed entry would let
// [valid openai model, null] parse as a non-empty all-OpenAI list and activate the overlay from a
// partial or poisoned registry. An inventory we cannot fully vouch for authorizes nothing.
function parseInventory<TModel extends SenpiModelPort>(
  available: unknown,
): readonly ParsedInventoryEntry<TModel>[] | undefined {
  if (!Array.isArray(available)) return undefined
  const entries: ParsedInventoryEntry<TModel>[] = []
  for (const candidate of available) {
    if (!isSafeSenpiModel<TModel>(candidate)) return undefined
    const provider = ownStringDataProperty(candidate, "provider")
    const modelId = ownStringDataProperty(candidate, "id")
    if (!provider || !modelId) return undefined
    entries.push({ provider, modelId, model: candidate })
  }
  return entries
}

function explicitUpstreamModelId<TModel extends SenpiModelPort>(
  registry: SenpiModelRegistryPort<TModel>,
  model: TModel,
): string | undefined {
  const getUpstreamModelId = registry.getUpstreamModelId
  if (typeof getUpstreamModelId !== "function") return undefined
  try {
    // .call keeps the receiver: the concrete senpi registry implements this as a prototype method,
    // and a bare invocation would run it with `this === undefined`, throwing into the catch below
    // and silently failing every alias closed - or masking a real registry fault.
    const upstream = getUpstreamModelId.call(registry, model)
    return typeof upstream === "string" && upstream.length > 0 ? upstream : undefined
  } catch {
    return undefined
  }
}

// An entry is openai-identified when it is canonically provider `openai`, or when its explicit
// upstream mapping names a maintained OpenAI model id.
function isOpenAiIdentified<TModel extends SenpiModelPort>(
  registry: SenpiModelRegistryPort<TModel>,
  entry: ParsedInventoryEntry<TModel>,
): boolean {
  if (entry.provider === "openai") return true
  const upstream = explicitUpstreamModelId(registry, entry.model)
  return upstream !== undefined && OPENAI_ONLY_RECOMMENDED_MODEL_IDS.has(upstream)
}

// `available` is the caller's ALREADY-TAKEN registry snapshot. The overlay must never sample
// getAvailable() itself: the caller classifies availability from its own snapshot, and a live
// registry can change between the two reads, letting this authorize a model absent from the
// snapshot the caller actually validated against.
export function compileOpenAiOnlyOverlay<TModel extends SenpiModelPort>(
  recommendations: Readonly<Record<string, OpenAiOnlyRecommendation>>,
  targetName: string,
  registry: SenpiModelRegistryPort<TModel>,
  available: unknown,
): OpenAiOnlyOverlay | undefined {
  const recommendation = Object.hasOwn(recommendations, targetName) ? recommendations[targetName] : undefined
  if (recommendation === undefined) return undefined

  const entries = parseInventory<TModel>(available)
  if (entries === undefined || entries.length === 0) return undefined
  if (!entries.every((entry) => isOpenAiIdentified(registry, entry))) return undefined

  for (const entry of entries) {
    if (entry.provider === "openai" && entry.modelId === recommendation.modelId) {
      return { recommendation, target: { provider: entry.provider, modelId: entry.modelId } }
    }
    const upstream = explicitUpstreamModelId(registry, entry.model)
    if (upstream !== undefined && upstream === recommendation.modelId) {
      return { recommendation, target: { provider: entry.provider, modelId: entry.modelId } }
    }
  }
  return undefined
}
