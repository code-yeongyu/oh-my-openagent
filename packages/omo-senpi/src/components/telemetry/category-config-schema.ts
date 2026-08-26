import { BUILTIN_CATEGORY_DEFAULTS } from "@oh-my-opencode/senpi-task/category-builtins"

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

/** `cat_*` property name for a builtin category: `visual-engineering` -> `cat_visual_engineering`. */
export function categoryPropertyName(categoryName: string): string {
  return `cat_${categoryName.replaceAll("-", "_")}`
}

/** Every builtin category, in the order the builtins ship, as its `cat_*` property name. */
export const CATEGORY_CONFIG_PROPERTY_NAMES: readonly string[] = Object.freeze(
  BUILTIN_CATEGORY_DEFAULTS.map(({ name }) => categoryPropertyName(name)),
)

/**
 * `category_config`: the effective builtin category -> model map as it stood at one config generation.
 * Each `cat_*` value is a composed closed vocabulary (`<provider>/<model_id>/<reasoning>` with an
 * optional `+<depth>` fallback marker, or `disabled`/`unavailable`/`absent`) - user category names
 * never enter the snapshot, only their counts. `combo_fingerprint` is deliberate redundancy: it turns
 * "how many distinct configured combinations exist" into a single GROUP BY.
 */
export const CATEGORY_CONFIG_SCHEMA = Object.freeze({
  "$session_id": STRING_PROPERTY,
  builtin_overridden_count: NUMBER_PROPERTY,
  cat_architect: STRING_PROPERTY,
  cat_artistry: STRING_PROPERTY,
  cat_deep: STRING_PROPERTY,
  cat_quick: STRING_PROPERTY,
  cat_ultrabrain: STRING_PROPERTY,
  cat_unspecified_high: STRING_PROPERTY,
  cat_unspecified_low: STRING_PROPERTY,
  cat_visual_engineering: STRING_PROPERTY,
  cat_writing: STRING_PROPERTY,
  combo_fingerprint: STRING_PROPERTY,
  config_generation: NUMBER_PROPERTY,
  source: enumProperty(CATEGORY_CONFIG_SOURCES),
  user_category_count: NUMBER_PROPERTY,
})
