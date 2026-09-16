import type { HarnessId, OmoHarnessId } from "../schema"
import type { OmoConfigRawLayer } from "./types"

export type CollectDisabledSkillsOptions = {
  readonly harness?: OmoHarnessId | HarnessId
  readonly layers: readonly OmoConfigRawLayer[]
  readonly profile?: string
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function namesAt(record: Record<string, unknown> | undefined): readonly string[] {
  const value = record?.["disabled_skills"]
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "")
}

function scopesOf(config: Record<string, unknown>, harness: string | undefined): readonly (Record<string, unknown> | undefined)[] {
  return [config, harness === undefined ? undefined : toRecord(config[`[${harness}]`])]
}

/**
 * The canonical skill denylist across every loaded layer.
 *
 * Unlike the generic view merge, where a later array replaces an earlier one, `disabled_skills`
 * is a UNION: a project layer cannot re-enable a skill the user layer turned off by omitting it.
 * The shared base, the `[harness]` block, and the selected profile's copies of both all count.
 */
export function collectDisabledSkills(options: CollectDisabledSkillsOptions): readonly string[] {
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
      for (const name of namesAt(scope)) names.add(name.trim())
    }
  }
  return [...names]
}
