import type { OmoConfig } from "@oh-my-opencode/omo-config-core"
import {
  BUILTIN_CATEGORY_DEFAULTS,
  resolveAgent,
  resolveCategory,
  resolveTaskAgents,
  type ModelSelectionSource,
  type SenpiModelPort,
} from "@oh-my-opencode/senpi-task"

import type { TaskModelRegistry } from "./planner"

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

/**
 * Every builtin and configured category under its canonical name, then every task agent, each resolved by
 * `resolveCategory` / `resolveAgent` exactly as the planner resolves a spawn. `variant` is the thinking level the
 * child runs at, in the planner's precedence (reasoning, then reasoningEffort, then variant).
 */
export function resolveModelRoutingRows(omoConfig: OmoConfig, registry: TaskModelRegistry): readonly ModelRoutingRow[] {
  const categoryNames = [...new Set([...BUILTIN_CATEGORY_NAMES, ...Object.keys(omoConfig.categories ?? {})])].sort()
  const categories = new Map<string, ModelRoutingRow>()
  for (const name of categoryNames) {
    const resolution = resolveCategory<SenpiModelPort>(name, omoConfig, registry)
    if (categories.has(resolution.category)) continue
    categories.set(resolution.category, resolution.kind === "resolved"
      ? routed("category", resolution.category, `${resolution.spec.provider}/${resolution.spec.modelId}`, resolution.modelSelection.source,
        resolution.spec.reasoning ?? resolution.spec.reasoningEffort ?? resolution.spec.variant)
      : unresolved("category", resolution.category))
  }
  const agents = resolveTaskAgents(omoConfig)
  const agentRows = Object.keys(agents).sort().map((name): ModelRoutingRow => {
    const resolution = resolveAgent(name, agents, registry, { omoConfig })
    if (resolution.kind !== "resolved") return unresolved("agent", resolution.agent)
    const record = resolution.resolved_model
    return routed("agent", resolution.agent, resolution.model, resolution.modelSource, record?.reasoning ?? record?.reasoning_effort ?? record?.variant)
  })
  return [...categories.values(), ...agentRows]
}

function routed(kind: ModelRoutingRow["kind"], name: string, effective: string, source: ModelSelectionSource, variant: string | undefined): ModelRoutingRow {
  return { kind, name, effective, source: source === "user" ? "override" : "provider-fallback", ...(variant === undefined ? {} : { variant }) }
}

function unresolved(kind: ModelRoutingRow["kind"], name: string): ModelRoutingRow {
  return { kind, name, effective: null, source: "unresolved" }
}
