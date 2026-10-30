import { canonicalHarnessName, harnessBlockKey, OMO_CONFIG_LEGACY_HARNESS_ALIASES } from "../schema"
import type { HarnessId, OmoHarnessId, OmoLegacyHarnessId } from "../schema"
import type { OmoConfigRawLayer } from "./types"

export type CollectDisabledSkillsOptions = {
  readonly harness?: OmoHarnessId | OmoLegacyHarnessId | HarnessId
  readonly layers: readonly OmoConfigRawLayer[]
  readonly profile?: string
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

type UnionedListKey = "disabled_skills" | "exclude_models"

function namesAt(record: Record<string, unknown> | undefined, key: UnionedListKey): readonly string[] {
  const value = record?.[key]
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "")
}

// Both spellings of a renamed harness are read. The denylist is a union, so there is no precedence
// to decide, and a raw layer handed in by a caller that did not canonicalize it still contributes.
function harnessBlockKeys(harness: string): readonly string[] {
  const canonical = canonicalHarnessName(harness)
  const legacy = Object.entries(OMO_CONFIG_LEGACY_HARNESS_ALIASES)
    .filter(([, target]) => target === canonical)
    .map(([name]) => harnessBlockKey(name))
  return [harnessBlockKey(canonical), ...legacy]
}

function scopesOf(config: Record<string, unknown>, harness: string | undefined): readonly (Record<string, unknown> | undefined)[] {
  if (harness === undefined) return [config]
  return [config, ...harnessBlockKeys(harness).map((key) => toRecord(config[key]))]
}

/**
 * The canonical skill denylist across every loaded layer.
 *
 * Unlike the generic view merge, where a later array replaces an earlier one, `disabled_skills`
 * is a UNION: a project layer cannot re-enable a skill the user layer turned off by omitting it.
 * The shared base, the `[harness]` block, and the selected profile's copies of both all count.
 */
export function collectDisabledSkills(options: CollectDisabledSkillsOptions): readonly string[] {
  return collectUnionedList("disabled_skills", options)
}

/**
 * The `exclude_models` denylist across every loaded layer, unioned by the same rule as
 * `disabled_skills`: a project layer cannot let back in a model the user layer keeps out.
 */
export function collectExcludedModels(options: CollectDisabledSkillsOptions): readonly string[] {
  return collectUnionedList("exclude_models", options)
}

function collectUnionedList(key: UnionedListKey, options: CollectDisabledSkillsOptions): readonly string[] {
  const names = new Set<string>()
  for (const layer of options.layers) {
    const config = toRecord(layer.config)
    if (config === undefined) continue
    const profile = options.profile === undefined ? undefined : toRecord(toRecord(config["profiles"])?.[options.profile])
    const scopes = [
      ...scopesOf(config, options.harness),
      ...(profile === undefined ? [] : scopesOf(profile, options.harness)),
    ]
    for (const scope of scopes) {
      for (const name of namesAt(scope, key)) names.add(name.trim())
    }
  }
  return [...names]
}
