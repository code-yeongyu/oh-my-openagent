import { excludedModelPattern, type OmoConfig } from "@oh-my-opencode/omo-config-core"

import { DEFAULT_MODEL_PROFILE_ORDER, RETIRED_MODEL_PROFILE_IDS } from "./builtin-profiles"
import { mergeModelProfiles, resolveModelProfile, type ModelProfileResolution, type ModelProfileRung } from "./resolve"

export type ModelProfileRungView = {
  readonly model: string
  readonly source: "built-in" | "omo.json" | "pin"
  readonly state: "applied" | "excluded" | "no-login" | "not-reached"
  readonly excludedBy?: string
}

export type ModelProfileView = {
  /** The lane id, or the literal `provider/model` pin. */
  readonly profile: string
  /** `set` when omo.json names it, `default` when the unset walk picked it. */
  readonly selection: "set" | "default"
  readonly applied?: string
  readonly rungs: readonly ModelProfileRungView[]
  readonly reason?: string
}

function rungLabel(rung: ModelProfileRung): string {
  const provider = rung.providers[0]
  return provider === undefined ? rung.model : `${provider}/${rung.model}`
}

function rungsOf(profile: string, config: OmoConfig): readonly { readonly label: string; readonly source: ModelProfileRungView["source"] }[] {
  if (profile.includes("/")) return [{ label: profile, source: "pin" }]
  const definition = mergeModelProfiles(config.model_profiles)[profile]
  if (definition === undefined) return []
  const source = definition.profile.source === "user" ? "omo.json" : "built-in"
  return definition.models.map((rung) => ({ label: rungLabel(rung), source }))
}

function view(profile: string, selection: ModelProfileView["selection"], resolution: ModelProfileResolution, config: OmoConfig): ModelProfileView {
  const applied = resolution.kind === "resolved" ? `${resolution.provider}/${resolution.modelId}` : undefined
  const appliedIndex = resolution.kind === "resolved" ? resolution.skipped.length : -1
  const rungs = rungsOf(profile, config).map(({ label, source }, index): ModelProfileRungView => {
    if (index === appliedIndex) return { model: applied ?? label, source, state: "applied" }
    const excludedBy = excludedModelPattern(label, config.exclude_models)
    if (excludedBy !== undefined) return { model: label, source, state: "excluded", excludedBy }
    return { model: label, source, state: appliedIndex !== -1 && index > appliedIndex ? "not-reached" : "no-login" }
  })
  return {
    profile,
    selection,
    ...(applied === undefined ? {} : { applied }),
    rungs,
    ...(resolution.kind === "unknown" ? { reason: resolution.message } : resolution.kind === "empty" ? { reason: "the profile lists no models" } : {}),
  }
}

/**
 * The lane the main session would start on, by the session-start walk minus its credential probe:
 * the configured `model_profile` (a retired id counts as unset), or the first default lane that
 * resolves. `exclude_models` is applied the way the session-start component applies it.
 */
export function describeModelProfile(config: OmoConfig, availableModels: readonly string[]): ModelProfileView {
  const available = availableModels.filter((selector) => excludedModelPattern(selector, config.exclude_models) === undefined)
  const configured = config.model_profile?.trim()
  const named = configured !== undefined && configured.length > 0 ? configured : undefined
  const explicit = named !== undefined && RETIRED_MODEL_PROFILE_IDS.has(named) && config.model_profiles?.[named] === undefined ? undefined : named
  const resolve = (active: string) => resolveModelProfile({ profiles: config.model_profiles, active, availableModels: available })
  if (explicit !== undefined) return view(explicit, "set", resolve(explicit), config)
  const [first] = DEFAULT_MODEL_PROFILE_ORDER
  const lane = DEFAULT_MODEL_PROFILE_ORDER.find((id) => resolve(id).kind === "resolved") ?? first
  return view(lane, "default", resolve(lane), config)
}
