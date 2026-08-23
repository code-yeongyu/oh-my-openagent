import type { OmoConfig } from "@oh-my-opencode/omo-config-core"
import {
  BUILTIN_CATEGORY_DEFAULTS,
  resolveCategory,
  type ChildPlanner,
  type SenpiModelPort,
} from "@oh-my-opencode/senpi-task"

import type { ResolveModelRegistry, TaskModelRegistry } from "./planner"

const BUILTIN_CATEGORY_NAMES: readonly string[] = BUILTIN_CATEGORY_DEFAULTS.map((definition) => definition.name)

/** Masking seam for the canonical map. Defaults to identity; the telemetry component injects the
 * provider/model allowlist mask so a generation only changes when the EXPORTABLE map changes. */
export type MaskCategoryModel = (provider: string, modelId: string) => {
  readonly provider: string
  readonly model_id: string
}

/**
 * The effective category map as it stood when a task was planned. `categories` holds one closed
 * value per builtin category (`<provider>/<model_id>/<reasoning>`, or `disabled`/`unavailable`);
 * user-defined category names never enter the snapshot, only their counts.
 */
export interface CategoryConfigSnapshot {
  readonly generation: number
  readonly categories: Readonly<Record<string, string>>
  readonly userCategoryCount: number
  readonly builtinOverriddenCount: number
}

export interface CategoryConfigGenerations {
  /** Canonicalize the live effective map and return the generation for it: a new one when the
   * canonical form changed since the last observation, the previous one when it did not. */
  readonly observe: (input: {
    readonly omoConfig: OmoConfig
    readonly registry: TaskModelRegistry
  }) => CategoryConfigSnapshot
  readonly current: () => CategoryConfigSnapshot | undefined
}

export function createCategoryConfigGenerations(mask: MaskCategoryModel = identityMask): CategoryConfigGenerations {
  let snapshot: CategoryConfigSnapshot | undefined
  let canonical: string | undefined
  return {
    observe: ({ omoConfig, registry }) => {
      const categories = canonicalCategories(omoConfig, registry, mask)
      const userNames = userCategoryNames(omoConfig)
      const next = {
        categories,
        userCategoryCount: userNames.filter((name) => !BUILTIN_CATEGORY_NAMES.includes(name)).length,
        builtinOverriddenCount: userNames.filter((name) => BUILTIN_CATEGORY_NAMES.includes(name)).length,
      }
      const form = canonicalForm(next)
      const previous = snapshot
      if (previous !== undefined && form === canonical) return previous
      const generation = previous === undefined ? 0 : previous.generation + 1
      const created: CategoryConfigSnapshot = { generation, ...next }
      snapshot = created
      canonical = form
      return created
    },
    current: () => snapshot,
  }
}

/**
 * Observe the effective category map at the planner seam - the only place that sees both the
 * config snapshot and the LIVE model registry, so a mid-session availability change is caught
 * where it actually decides a model. Observation is best effort: it never changes, delays or
 * fails the plan it rides along with.
 */
export function createGenerationObservingPlanner(input: {
  readonly planner: ChildPlanner
  readonly omoConfig: OmoConfig
  readonly resolveRegistry: ResolveModelRegistry
  readonly generations: CategoryConfigGenerations
}): ChildPlanner {
  const { planner, omoConfig, resolveRegistry, generations } = input
  return (spec) => {
    const resolution = planner(spec)
    if (resolution.kind !== "resolved") return resolution
    const registry = resolveRegistry()
    if (registry !== undefined) generations.observe({ omoConfig, registry })
    return resolution
  }
}

function identityMask(provider: string, modelId: string): { readonly provider: string; readonly model_id: string } {
  return { provider, model_id: modelId }
}

function canonicalForm(input: {
  readonly categories: Readonly<Record<string, string>>
  readonly userCategoryCount: number
  readonly builtinOverriddenCount: number
}): string {
  const entries = Object.entries(input.categories)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([name, value]) => `${name}=${value}`)
    .join(";")
  return `${entries}|u=${input.userCategoryCount}|o=${input.builtinOverriddenCount}`
}

function userCategoryNames(omoConfig: OmoConfig): readonly string[] {
  return Object.keys(omoConfig.categories ?? {})
}

function canonicalCategories(
  omoConfig: OmoConfig,
  registry: TaskModelRegistry,
  mask: MaskCategoryModel,
): Readonly<Record<string, string>> {
  const entries = BUILTIN_CATEGORY_NAMES.map((name) => [name, encodeCategory(name, omoConfig, registry, mask)] as const)
  return Object.fromEntries(entries)
}

function encodeCategory(
  name: string,
  omoConfig: OmoConfig,
  registry: TaskModelRegistry,
  mask: MaskCategoryModel,
): string {
  const resolution = resolveCategory<SenpiModelPort>(name, omoConfig, registry)
  switch (resolution.kind) {
    case "resolved": {
      const masked = mask(resolution.spec.provider, resolution.spec.modelId)
      const reasoning = resolution.spec.reasoning ?? resolution.spec.reasoningEffort ?? resolution.spec.variant ?? "none"
      return `${masked.provider}/${masked.model_id}/${reasoning}`
    }
    case "disabled":
      return "disabled"
    case "model_unavailable":
      return "unavailable"
    case "not_found":
      return "absent"
    default:
      return assertNever(resolution)
  }
}

function assertNever(value: never): never {
  throw new Error(`unhandled category resolution: ${JSON.stringify(value)}`)
}
