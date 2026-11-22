import { isExcludedModel, type OmoConfig } from "@oh-my-opencode/omo-config-core"
import {
  BUILTIN_CATEGORY_DEFAULTS,
  resolveAgent,
  resolveCategory,
  type AgentDefinition,
  type ModelSelectionSource,
  type SenpiModelPort,
} from "@oh-my-opencode/senpi-task"

import { inheritParentFastMode } from "./fast-mode-inheritance"
import type { TaskModelRegistry } from "./planner"
import type { ParentServiceTier } from "./runtime-context"

export type ModelRoutingSource = "override" | "provider-fallback" | "unresolved"

/** One lane of `omo.modelRouting.resolve`: the model a spawn of it runs first, as the spawn resolvers pick it. */
export type ModelRoutingRow = {
  readonly kind: "category" | "agent"
  readonly name: string
  readonly effective: string | null
  readonly source: ModelRoutingSource
  readonly variant?: string
}

const BUILTIN_CATEGORY_NAMES = BUILTIN_CATEGORY_DEFAULTS.map((definition) => definition.name)

/** What the planner resolves a spawn against besides the config: its agent table and the parent's service tier. */
export type ModelRoutingPlannerInputs = {
  readonly agents: Readonly<Record<string, AgentDefinition>>
  readonly parentServiceTier?: ParentServiceTier
}

/**
 * Every builtin and configured category, then every task agent, each under its canonical name and resolved by
 * `resolveCategory` / `resolveAgent` exactly as the planner resolves a spawn: against the planner's own agent table,
 * then the parent fast-tier step. `variant` is the thinking level the child runs at, in the planner's precedence
 * (reasoning, then reasoningEffort, then variant). The round-robin distributor is not consulted, so a read never
 * advances a rotation: a `round_robin` lane shows its first entry.
 */
export function resolveModelRoutingRows(
  omoConfig: OmoConfig,
  registry: TaskModelRegistry,
  planner: ModelRoutingPlannerInputs,
): readonly ModelRoutingRow[] {
  const effectiveModel = (model: string): string => {
    const fast = inheritParentFastMode({ model }, registry, planner.parentServiceTier).model
    // The -fast sibling is a different model: exclude_models keeps the planned one, as the planner does.
    return isExcludedModel(fast, omoConfig.exclude_models) ? model : fast
  }
  const categoryNames = [...new Set([...BUILTIN_CATEGORY_NAMES, ...Object.keys(omoConfig.categories ?? {})])].sort()
  const categories = new Map<string, ModelRoutingRow>()
  for (const name of categoryNames) {
    const resolution = resolveCategory<SenpiModelPort>(name, omoConfig, registry)
    if (categories.has(resolution.category)) continue
    categories.set(
      resolution.category,
      resolution.kind === "resolved"
        ? routed(
            "category",
            resolution.category,
            effectiveModel(`${resolution.spec.provider}/${resolution.spec.modelId}`),
            resolution.modelSelection.source,
            resolution.spec.reasoning ?? resolution.spec.reasoningEffort ?? resolution.spec.variant,
          )
        : unresolved("category", resolution.category),
    )
  }
  // A retired alias key (omo-senpi-*) resolves to its canonical omo-native-* agent, so it shares that row.
  const agents = new Map<string, ModelRoutingRow>()
  for (const name of Object.keys(planner.agents).sort()) {
    const resolution = resolveAgent(name, planner.agents, registry, { omoConfig })
    if (agents.has(resolution.agent)) continue
    if (resolution.kind !== "resolved") {
      agents.set(resolution.agent, unresolved("agent", resolution.agent))
      continue
    }
    const record = resolution.resolved_model
    agents.set(
      resolution.agent,
      routed(
        "agent",
        resolution.agent,
        effectiveModel(resolution.model),
        resolution.modelSource,
        record?.reasoning ?? record?.reasoning_effort ?? record?.variant,
      ),
    )
  }
  return [...categories.values(), ...agents.values()]
}

function routed(
  kind: ModelRoutingRow["kind"],
  name: string,
  effective: string,
  source: ModelSelectionSource,
  variant: string | undefined,
): ModelRoutingRow {
  return {
    kind,
    name,
    effective,
    source: source === "user" ? "override" : "provider-fallback",
    ...(variant === undefined ? {} : { variant }),
  }
}

function unresolved(kind: ModelRoutingRow["kind"], name: string): ModelRoutingRow {
  return { kind, name, effective: null, source: "unresolved" }
}
