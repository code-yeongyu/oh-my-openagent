import { BUILTIN_CATEGORY_DEFAULTS } from "@oh-my-opencode/senpi-task/category-builtins"

import { DELEGATION_REASONING_EFFORTS } from "./delegation-schema"
import type { OmoNativePropertySchema } from "./event-schemas"
import { ALL_KNOWN_MODEL_IDS, KNOWN_PROVIDERS } from "./model-vocabulary"

const NUMBER_PROPERTY = Object.freeze({ type: "number" } as const)
const STRING_PROPERTY = Object.freeze({ type: "string" } as const)

function enumProperty<const Values extends readonly string[]>(values: Values): Readonly<{
  type: "string"
  values: Values
}> {
  return Object.freeze({ type: "string", values: Object.freeze(values) })
}

/** Snapshot provenance; reuses the `session_started.reason` vocabulary so snapshots dedupe across re-register. */
export const CATEGORY_CONFIG_SOURCES = ["startup", "reload", "new", "resume", "fork"] as const

/** How a builtin category resolved: `set` carries provider/model/reasoning/depth, the rest carry nothing else. */
export const CATEGORY_STATES = ["set", "disabled", "unavailable", "absent"] as const
export type CategoryState = (typeof CATEGORY_STATES)[number]

/** A provider outside the shipped vocabulary; its name never leaves the machine. */
export const OTHER_VALUE = "other"
export const CATEGORY_PROVIDER_VALUES = Object.freeze([...KNOWN_PROVIDERS, OTHER_VALUE])
export const CATEGORY_MODEL_VALUES = Object.freeze([...ALL_KNOWN_MODEL_IDS, OTHER_VALUE])

/** Property-name stem for a builtin category: `visual-engineering` -> `cat_visual_engineering`. */
export function categoryPropertyName(categoryName: string): string {
  return `cat_${categoryName.replaceAll("-", "_")}`
}

function categoryProperties(categoryName: string): [string, OmoNativePropertySchema][] {
  const stem = categoryPropertyName(categoryName)
  return [
    [`${stem}_state`, enumProperty(CATEGORY_STATES)],
    [`${stem}_provider`, enumProperty(CATEGORY_PROVIDER_VALUES)],
    [`${stem}_model`, enumProperty(CATEGORY_MODEL_VALUES)],
    [`${stem}_reasoning`, enumProperty(DELEGATION_REASONING_EFFORTS)],
    [`${stem}_depth`, NUMBER_PROPERTY],
  ]
}

const CATEGORY_CONFIG_FIXED_PROPERTIES = {
  "$session_id": STRING_PROPERTY,
  builtin_overridden_count: NUMBER_PROPERTY,
  combo_fingerprint: STRING_PROPERTY,
  config_generation: NUMBER_PROPERTY,
  source: enumProperty(CATEGORY_CONFIG_SOURCES),
  user_category_count: NUMBER_PROPERTY,
} as const

/**
 * `category_config`: the effective builtin category -> model map as it stood at one config generation.
 * Each builtin category is five closed attributes: `cat_<c>_state`, and when it is `set`,
 * `cat_<c>_provider` and `cat_<c>_model` (shipped vocabulary or `other`), `cat_<c>_reasoning` and
 * the fallback-chain `cat_<c>_depth`. User category names never enter the snapshot, only their
 * counts. `combo_fingerprint` is deliberate redundancy: it turns "how many distinct configured
 * combinations exist" into a single GROUP BY.
 */
export const CATEGORY_CONFIG_SCHEMA: Readonly<typeof CATEGORY_CONFIG_FIXED_PROPERTIES & Record<string, OmoNativePropertySchema>> = Object.freeze({
  ...CATEGORY_CONFIG_FIXED_PROPERTIES,
  ...Object.fromEntries(BUILTIN_CATEGORY_DEFAULTS.flatMap(({ name }) => categoryProperties(name))),
})
