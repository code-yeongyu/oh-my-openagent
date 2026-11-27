import {
  loadOmoConfig,
  type OmoConfigDiagnostic,
  type OmoConfigSource,
  resolveModelReferences,
} from "@oh-my-opencode/omo-config-core"
import { describeModelChains, type ModelChainEntry } from "@oh-my-opencode/senpi-task/model-chains"
import type { ConfigContext } from "."
import { builtinNames, EMPTY_REGISTRY, isModelId } from "./allowlist"
import { type EngineView, engineView, readEngineLayers } from "./engine"

/** A category's or agent's model chain; a rung whose id fails the model-id shape is dropped and marks the entry. */
export type RoutingEntry = {
  readonly name: string
  readonly source: "user" | "builtin"
  readonly chain: readonly string[]
  readonly value_withheld?: true
}

/**
 * The configuration as the SDK reports it: each file by its scope, with whether it exists and loaded, and the load's
 * diagnostics by kind and count; the routing of every category and agent the SDK may name; and the typed engine
 * settings. A file's path and a diagnostic's text stay with the command a person runs (`omo doctor`), which renders
 * the same core's result in full.
 */
export type ConfigStatus = {
  readonly files: readonly {
    readonly scope: OmoConfigSource["scope"]
    readonly exists: boolean
    readonly loaded: boolean
  }[]
  readonly diagnostics: readonly { readonly kind: OmoConfigDiagnostic["kind"]; readonly count: number }[]
  /** Builtin categories and agents only: a name a config file defines is a key name from that file. */
  readonly routing: { readonly categories: readonly RoutingEntry[]; readonly agents: readonly RoutingEntry[] }
  /** The effective engine settings; a fallback chain keyed or filled by an id that fails the model-id shape is left out. */
  readonly engine: EngineView
}

function byKind(diagnostics: readonly OmoConfigDiagnostic[]): ConfigStatus["diagnostics"] {
  const counts = new Map<OmoConfigDiagnostic["kind"], number>()
  for (const { kind } of diagnostics) counts.set(kind, (counts.get(kind) ?? 0) + 1)
  return [...counts].map(([kind, count]) => ({ kind, count }))
}

function routingEntries(entries: readonly ModelChainEntry[], names: ReadonlySet<string>): readonly RoutingEntry[] {
  return entries
    .filter((entry) => names.has(entry.name))
    .map((entry) => {
      const models = entry.rungs.map((rung) => rung.model)
      const chain = models.filter(isModelId)
      return {
        name: entry.name,
        source: entry.rungs.some((rung) => rung.source !== "built-in") ? "user" : "builtin",
        chain,
        ...(chain.length === models.length ? {} : { value_withheld: true as const }),
      }
    })
}

function shownEngine(view: EngineView): EngineView {
  const chains = Object.entries(view.retry.fallbackChains).filter(
    ([model, chain]) => isModelId(model) && chain.every(isModelId),
  )
  return { ...view, retry: { ...view.retry, fallbackChains: Object.fromEntries(chains) } }
}

export function configStatus(context: ConfigContext): ConfigStatus {
  const { sources, diagnostics, config } = loadOmoConfig({ cwd: context.cwd, env: context.env, harness: "senpi" })
  const routing = describeModelChains(resolveModelReferences(config).view, EMPTY_REGISTRY)
  const builtin = builtinNames()
  const engine = readEngineLayers(context)
  return {
    files: sources.map(({ scope, exists, loaded }) => ({ scope, exists, loaded })),
    diagnostics: byKind(diagnostics),
    routing: {
      categories: routingEntries(routing.categories, builtin.categories),
      agents: routingEntries(routing.agents, builtin.agents),
    },
    engine: shownEngine(engineView(engine.global.document, engine.project.document)),
  }
}
