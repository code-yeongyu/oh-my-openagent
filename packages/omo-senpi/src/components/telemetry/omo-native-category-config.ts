import { createHash } from "node:crypto"

import type { OmoConfig } from "@oh-my-opencode/omo-config-core"
import type { EventTelemetryProperties } from "@oh-my-opencode/telemetry-core"
import { BUILTIN_CATEGORY_DEFAULTS } from "@oh-my-opencode/senpi-task/category-builtins"
import type { SenpiModelPort } from "@oh-my-opencode/senpi-task"
import { resolveCategory } from "@oh-my-opencode/senpi-task/category-resolver"

import { CATEGORY_FALLBACK_CHAINS } from "../../../../senpi-task/src/category/fallback-chains"
import type { TaskModelRegistry } from "../task/planner"
import { categoryPropertyName, OTHER_VALUE, type CategoryState } from "./category-config-schema"
import { DELEGATION_REASONING_EFFORTS } from "./delegation-schema"
import { ALL_KNOWN_MODEL_IDS, KNOWN_PROVIDERS } from "./model-vocabulary"
import type { OmoNativeEventName } from "./product-identity"

const BUILTIN_CATEGORY_NAMES: readonly string[] = BUILTIN_CATEGORY_DEFAULTS.map(({ name }) => name)
const FINGERPRINT_LENGTH = 16

export type CategoryConfigCaptureOptions = {
  readonly captureEvent: (name: OmoNativeEventName, properties: EventTelemetryProperties) => void
  readonly omoConfig: OmoConfig
  readonly sessionHash: string
}

export type CategoryConfigCapture = {
  /**
   * Capture the effective builtin category map as it stands NOW, against the live registry. A
   * generation is spent only when the canonical exportable map changed, so a re-registration or a
   * config reload the planner never consumed produces no duplicate row.
   */
  readonly observe: (input: { readonly registry: TaskModelRegistry; readonly source: string }) => void
}

export function createCategoryConfigCapture(options: CategoryConfigCaptureOptions): CategoryConfigCapture {
  let generation = -1
  let canonical: string | undefined
  return {
    observe: ({ registry, source }) => {
      const categories = encodeCategories(options.omoConfig, registry)
      const counts = categoryCounts(options.omoConfig)
      const form = canonicalForm(categories, counts)
      if (form === canonical) return
      canonical = form
      generation += 1
      options.captureEvent("category_config", {
        $session_id: options.sessionHash,
        config_generation: generation,
        ...Object.fromEntries(Object.entries(categories).flatMap(([name, value]) => categoryProperties(name, value))),
        combo_fingerprint: createHash("sha256").update(form).digest("hex").slice(0, FINGERPRINT_LENGTH),
        custom_category_count: counts.user,
        builtin_overridden_count: counts.overridden,
        source,
      })
    },
  }
}

type CategoryValue =
  | { readonly state: Exclude<CategoryState, "set"> }
  | { readonly state: "set"; readonly provider: string; readonly model: string; readonly reasoning: string; readonly depth: number }

// One closed value per builtin category. The map is keyed by category NAME (not property name) so the
// canonical form stays comparable with the planner-side generation counter's canonicalization.
function encodeCategories(
  omoConfig: OmoConfig,
  registry: TaskModelRegistry,
): Readonly<Record<string, CategoryValue>> {
  return Object.fromEntries(BUILTIN_CATEGORY_NAMES.map((name) => [name, encodeCategory(name, omoConfig, registry)]))
}

/**
 * The resolution as closed values: provider and model only from the shipped vocabulary, everything
 * else `other`, so a user's gateway or fine-tune name can never become a value.
 */
function encodeCategory(name: string, omoConfig: OmoConfig, registry: TaskModelRegistry): CategoryValue {
  const resolution = resolveResilient(name, omoConfig, registry)
  switch (resolution.kind) {
    case "resolved":
      return {
        state: "set",
        provider: KNOWN_PROVIDER_IDS.has(resolution.spec.provider) ? resolution.spec.provider : OTHER_VALUE,
        model: ALL_KNOWN_MODEL_IDS.has(resolution.spec.modelId) ? resolution.spec.modelId : OTHER_VALUE,
        reasoning: maskReasoning(resolution.spec.reasoning ?? resolution.spec.reasoningEffort ?? resolution.spec.variant),
        depth: chainDepth(name, resolution.modelSelection.fallbackEntry?.model),
      }
    case "disabled":
      return { state: "disabled" }
    case "model_unavailable":
      return { state: "unavailable" }
    case "not_found":
      return { state: "absent" }
    default:
      return assertNever(resolution)
  }
}

const KNOWN_PROVIDER_IDS: ReadonlySet<string> = new Set(KNOWN_PROVIDERS)

function categoryProperties(name: string, value: CategoryValue): [string, string | number][] {
  const stem = categoryPropertyName(name)
  if (value.state !== "set") return [[`${stem}_state`, value.state]]
  return [
    [`${stem}_state`, value.state],
    [`${stem}_provider`, value.provider],
    [`${stem}_model`, value.model],
    [`${stem}_reasoning`, value.reasoning],
    [`${stem}_depth`, value.depth],
  ]
}

const REASONING_EFFORTS: ReadonlySet<string> = new Set(DELEGATION_REASONING_EFFORTS)

// Same rule as delegation_completed's reasoning_effort: a harness-native preset is real but unbounded,
// so it exports as `other`; absent exports as `none`. Keeps every `cat_*_reasoning` value inside its enum.
function maskReasoning(level: string | undefined): string {
  if (level === undefined) return "none"
  return REASONING_EFFORTS.has(level) ? level : "other"
}

type Resolution = ReturnType<typeof resolveCategory<SenpiModelPort>>

// A live registry can throw (a host mid-teardown, a stale proxy). Telemetry treats that exactly like
// an unresolvable category rather than failing the session-start path it rides on.
function resolveResilient(name: string, omoConfig: OmoConfig, registry: TaskModelRegistry): Resolution {
  try {
    return resolveCategory<SenpiModelPort>(name, omoConfig, registry)
  } catch {
    return {
      kind: "model_unavailable",
      category: name,
      attemptedModel: undefined,
      availableModels: [],
      availableCategories: [],
    }
  }
}

// How deep in the builtin chain the executed rung sits. 0 (the head, or a user-configured model that
// matched no rung) is the default and adds no suffix; a deeper rung means the chain degraded.
function chainDepth(categoryName: string, matchedModel: string | undefined): number {
  if (matchedModel === undefined) return 0
  const chain = Object.hasOwn(CATEGORY_FALLBACK_CHAINS, categoryName)
    ? CATEGORY_FALLBACK_CHAINS[categoryName]
    : undefined
  const index = chain?.findIndex((rung) => rung.model === matchedModel) ?? -1
  return index < 0 ? 0 : index
}

// User category NAMES are free text and never leave the machine; only how many exist and how many
// shadow a builtin.
function categoryCounts(omoConfig: OmoConfig): { readonly user: number; readonly overridden: number } {
  const configured = Object.keys(omoConfig.categories ?? {})
  return {
    user: configured.filter((name) => !BUILTIN_CATEGORY_NAMES.includes(name)).length,
    overridden: configured.filter((name) => BUILTIN_CATEGORY_NAMES.includes(name)).length,
  }
}

// Name-sorted serialization, so the fingerprint is stable across omo.json key order and across
// property insertion order: the same effective configuration always fingerprints identically.
function canonicalForm(
  categories: Readonly<Record<string, CategoryValue>>,
  counts: { readonly user: number; readonly overridden: number },
): string {
  const entries = Object.entries(categories)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([name, value]) => `${name}=${categoryToken(value)};`)
    .join("")
  return `${entries}|u=${counts.user}|o=${counts.overridden}`
}

function categoryToken(value: CategoryValue): string {
  if (value.state !== "set") return value.state
  return `${value.provider}/${value.model}/${value.reasoning}${value.depth === 0 ? "" : `+${value.depth}`}`
}

function assertNever(value: never): never {
  throw new Error(`unhandled category resolution: ${String(value)}`)
}
