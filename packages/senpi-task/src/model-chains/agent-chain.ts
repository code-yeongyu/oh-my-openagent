import type { OmoConfig } from "@oh-my-opencode/omo-config-core"

import { agentModelCandidates } from "../agents/agent-model-entry"
import { AGENT_FALLBACK_CHAINS } from "../agents/builtin/fallback-chains"
import { resolveAgent } from "../agents/resolve-agent"
import type { AgentDefinition } from "../agents/types"
import { resolveCategory } from "../category/resolver"
import type { SenpiModelPort, SenpiModelRegistryPort } from "../category/types"
import { categoryRuntimeChain } from "./category-chain"
import { builtinRungs, classifyRungs, type DeclaredRung } from "./rungs"
import type { ModelChainEntry } from "./types"

function ownModels(config: OmoConfig, name: string): ReadonlySet<string> {
  const entry = config.agents !== undefined && Object.hasOwn(config.agents, name) ? config.agents[name] : undefined
  if (entry === undefined) return new Set()
  return new Set(agentModelCandidates(entry.model, entry.models, {}).map((candidate) => candidate.model))
}

/**
 * One agent as a spawn sees it: `resolveAgent` supplies the runtime chain; the declared rungs are
 * its own model/models (omo.json or the builtin definition), each policy category's runtime chain,
 * then the builtin agent chain.
 */
export function describeAgentChain<TModel extends SenpiModelPort>(
  name: string,
  agents: Readonly<Record<string, AgentDefinition>>,
  config: OmoConfig,
  registry: SenpiModelRegistryPort<TModel>,
  available: ReadonlySet<string>,
): ModelChainEntry {
  const definition = agents[name]
  if (definition?.disable === true) return { kind: "agent", name, status: "disabled", runtime: [], rungs: [], reason: "disabled by omo.json" }
  const fromConfig = ownModels(config, name)
  const declared: readonly DeclaredRung[] = [
    ...agentModelCandidates(definition?.model, definition?.models, {}).map((candidate): DeclaredRung => ({
      model: candidate.model,
      source: fromConfig.has(candidate.model) ? "omo.json" : "built-in",
    })),
    ...(definition?.categories ?? []).flatMap((category) =>
      categoryRuntimeChain(resolveCategory(category, config, registry)).map((model): DeclaredRung => ({ model, source: `category:${category}` }))
    ),
    ...builtinRungs(Object.hasOwn(AGENT_FALLBACK_CHAINS, name) ? AGENT_FALLBACK_CHAINS[name] : undefined, available),
  ]
  const result = resolveAgent(name, agents, registry, { omoConfig: config })
  const runtime = result.kind === "resolved" ? [result.model, ...(result.fallback_models ?? []).map((model) => model.display)] : []
  return {
    kind: "agent",
    name,
    status: result.kind === "resolved" ? "resolved" : "unavailable",
    ...(runtime[0] === undefined ? {} : { primary: runtime[0] }),
    runtime,
    rungs: classifyRungs(declared, runtime, available, config.exclude_models),
    ...(result.kind === "model_unavailable"
      ? { reason: result.attemptedModel === undefined ? "no rung is usable" : `${result.attemptedModel} is not usable` }
      : {}),
  }
}
