// Connected-first ordering of the Kibitzer sidecar's category candidates (#9216).
//
// Category resolution follows the `task` tool's rule that a user pin wins: when no pinned model is
// connected it still returns the first pin, because the catalog knows it. A delegated task can let
// the user see that failure; the sidecar child cannot - it fails its auth check at once and never
// reaches the connected rung it carries as a fallback. So, only here and only while the registry's
// availability list is known and non-empty, the first CONNECTED candidate leads: pinned models in pin
// order, then the category's builtin chain. Unconnected candidates stay reachable behind them (an
// extension provider can register after the snapshot) but never lead. An empty or malformed list is
// the stale first-turn snapshot, not an answer, and leaves the resolution as it was.

import type { OmoConfig } from "@oh-my-opencode/omo-config-core"
import { resolveCategory, type SenpiModelPort, type SenpiModelRegistryPort } from "@oh-my-opencode/senpi-task"
import { parseAvailableModels } from "@oh-my-opencode/senpi-task/category-resolver"

import type { ReflectionModelCandidate, ReflectionThinkingLevel } from "../worker/resolve-model"

export interface KibitzerCandidateOrderInput {
  readonly category: string
  readonly config: OmoConfig
  readonly registry: SenpiModelRegistryPort<SenpiModelPort>
  readonly model: string
  readonly thinking?: ReflectionThinkingLevel
  readonly fallbacks: readonly ReflectionModelCandidate[]
}

export type KibitzerCandidateOrder =
  | { readonly kind: "availability_unknown" }
  | {
    readonly kind: "ordered"
    readonly model: string
    readonly thinking?: ReflectionThinkingLevel
    readonly fallbacks: readonly ReflectionModelCandidate[]
  }
  | { readonly kind: "none_connected"; readonly missingProviders: readonly string[] }

export function orderKibitzerCandidatesByConnection(input: KibitzerCandidateOrderInput): KibitzerCandidateOrder {
  const available = parseAvailableModels(input.registry.getAvailable())
  if (!available.validContainer || available.models.length === 0) return { kind: "availability_unknown" }
  const connected = new Set(available.models)
  const candidates: readonly ReflectionModelCandidate[] = [
    { model: input.model, ...(input.thinking === undefined ? {} : { thinking: input.thinking }) },
    ...input.fallbacks,
  ]
  const leading = candidates.filter((candidate) => connected.has(candidate.model))
  const trailing = candidates.filter((candidate) => !connected.has(candidate.model))
  const [lead, ...rest] = [...leading, ...trailing]
  if (lead === undefined || leading.length === 0) {
    return { kind: "none_connected", missingProviders: missingProviders(input, trailing) }
  }
  return {
    kind: "ordered",
    model: lead.model,
    ...(lead.thinking === undefined ? {} : { thinking: lead.thinking }),
    fallbacks: rest,
  }
}

// The providers a `/login` would revive: the unconnected pins' own providers in pin order, then the
// builtin chain's (asked without the user's pin, which otherwise short-circuits the chain report).
function missingProviders(input: KibitzerCandidateOrderInput, unconnected: readonly ReflectionModelCandidate[]): readonly string[] {
  const providers = unconnected.map((candidate) => candidate.model.slice(0, candidate.model.indexOf("/")))
  const { [input.category]: _pin, ...otherCategories } = input.config.categories ?? {}
  const chain = resolveCategory(input.category, { ...input.config, categories: otherCategories }, input.registry)
  if (chain.kind === "model_unavailable") providers.push(...(chain.missing_providers ?? []))
  return [...new Set(providers.filter((provider) => provider.length > 0))]
}
