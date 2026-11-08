import type { OmoConfig } from "@oh-my-opencode/omo-config-core"

import { resolveTaskAgents } from "../agents/task-agents"
import { DEFAULT_CATEGORIES } from "../category/builtins"
import { parseAvailableModels } from "../category/registry-models"
import type { SenpiModelPort, SenpiModelRegistryPort } from "../category/types"
import { describeAgentChain } from "./agent-chain"
import { describeCategoryChain } from "./category-chain"
import type { ModelChainsReport } from "./types"

export type { ChainRung, ChainRungSource, ChainRungState, ModelChainEntry, ModelChainsReport } from "./types"

/**
 * Every builtin and configured category and every task agent, resolved by the spawn resolvers
 * against `registry` (the unfiltered model list: `exclude_models` is applied by the resolvers, and
 * a rung it removes is reported as excluded rather than missing).
 */
export function describeModelChains<TModel extends SenpiModelPort>(
  config: OmoConfig,
  registry: SenpiModelRegistryPort<TModel>,
): ModelChainsReport {
  const parsed = parseAvailableModels(registry.getAvailable())
  if (!parsed.validContainer) throw new Error("the model registry did not return a model list")
  const available: ReadonlySet<string> = new Set(parsed.models)
  const categoryNames = Array.from(new Set([...Object.keys(DEFAULT_CATEGORIES), ...Object.keys(config.categories ?? {})])).sort()
  const agents = resolveTaskAgents(config)
  return {
    excludeModels: config.exclude_models ?? [],
    categories: categoryNames.map((name) => describeCategoryChain(name, config, registry, available)),
    agents: Object.keys(agents).sort().map((name) => describeAgentChain(name, agents, config, registry, available)),
  }
}
