import { resolveModelForDelegateTask, type DelegateFallbackEntry } from "@oh-my-opencode/delegate-core"
import type { OmoFallbackModelObject, OmoModelProfile } from "@oh-my-opencode/omo-config-core"

import { BUILTIN_MODEL_PROFILES } from "./builtin-profiles"

export type ModelProfileSource = "builtin" | "user" | "pin"

export type ModelProfileSummary = {
  readonly id: string
  readonly displayName: string
  readonly source: ModelProfileSource
}

/** One rung of a profile chain, after builtin entries and user config entries are unified. */
export type ModelProfileRung = {
  readonly providers: readonly string[]
  readonly model: string
  readonly reasoning?: string
}

export type ModelProfileDefinition = {
  readonly profile: ModelProfileSummary
  readonly models: readonly ModelProfileRung[]
}

export type ResolveModelProfileInput = {
  /** `omo.json` `model_profiles`, already catalog-expanded by `resolveModelReferences`. */
  readonly profiles?: Readonly<Record<string, OmoModelProfile>> | undefined
  /** `omo.json` `model_profile`: either a profile id or a literal `provider/model` pin. */
  readonly active: string
  /** The flat `provider/id` list the live senpi registry reports. */
  readonly availableModels: readonly string[]
}

export type ModelProfileResolution =
  | {
      readonly kind: "resolved"
      readonly profile: ModelProfileSummary
      readonly provider: string
      readonly modelId: string
      readonly reasoning?: string
      readonly skipped: readonly string[]
    }
  | { readonly kind: "unavailable"; readonly profile: ModelProfileSummary; readonly chain: readonly string[] }
  | { readonly kind: "empty"; readonly profile: ModelProfileSummary }
  | { readonly kind: "unknown"; readonly name: string; readonly known: readonly string[]; readonly message: string }

type RungMatch = {
  readonly provider: string
  readonly modelId: string
  readonly reasoning?: string
}

function builtinRung(entry: DelegateFallbackEntry): ModelProfileRung {
  return {
    providers: entry.providers,
    model: entry.model,
    ...(entry.variant !== undefined ? { reasoning: entry.variant } : {}),
  }
}

// A user chain entry is either a string - `provider/model`, a bare model id, either one optionally
// carrying the canonical `:<reasoning>` suffix omo.json normalizes to - or the
// `{ model, reasoning }` object form. A bare id leaves `providers` EMPTY on purpose: the matcher
// then accepts that model from whichever provider the registry serves it through, which is exactly
// what a user who named no provider asked for.
function userRung(entry: string | OmoFallbackModelObject): ModelProfileRung {
  const raw = typeof entry === "string" ? entry.trim() : entry.model.trim()
  const suffixIndex = raw.lastIndexOf(":")
  const selector = suffixIndex > 0 ? raw.slice(0, suffixIndex) : raw
  const suffixReasoning = suffixIndex > 0 ? raw.slice(suffixIndex + 1) : undefined
  const reasoning = (typeof entry === "string" ? undefined : entry.reasoning) ?? suffixReasoning

  const separatorIndex = selector.indexOf("/")
  const scoped = separatorIndex > 0 && separatorIndex < selector.length - 1
  return {
    providers: scoped ? [selector.slice(0, separatorIndex)] : [],
    model: scoped ? selector.slice(separatorIndex + 1) : selector,
    ...(reasoning !== undefined && reasoning.length > 0 ? { reasoning } : {}),
  }
}

/**
 * The builtin table overlaid with `omo.json` `model_profiles`. A user entry replaces a builtin of
 * the same name WHOLESALE - no per-field merge, so a label-only override does not inherit the
 * builtin chain and is reported as `empty` rather than silently running builtin models under a
 * user's label.
 */
export function mergeModelProfiles(
  profiles?: Readonly<Record<string, OmoModelProfile>> | undefined,
): Readonly<Record<string, ModelProfileDefinition>> {
  const merged = new Map<string, ModelProfileDefinition>()
  for (const [id, builtin] of Object.entries(BUILTIN_MODEL_PROFILES)) {
    merged.set(id, {
      profile: { id, displayName: builtin.displayName, source: "builtin" },
      models: builtin.models.map(builtinRung),
    })
  }
  for (const [id, entry] of Object.entries(profiles ?? {})) {
    merged.set(id, {
      profile: { id, displayName: entry.display_name ?? id, source: "user" },
      models: (entry.models ?? []).map(userRung),
    })
  }
  // fromEntries defines own data properties, so a `__proto__` key in a config file stays inert data.
  return Object.fromEntries(merged)
}

function formatRung(rung: ModelProfileRung): string {
  const provider = rung.providers[0]
  return provider === undefined ? rung.model : `${provider}/${rung.model}`
}

function unknownProfileMessage(name: string, known: readonly string[]): string {
  return `model_profile "${name}" is not defined; known profiles: ${known.join(", ")}`
}

// The rung walk delegates to the SAME matcher category chains use
// (`packages/delegate-core/src/model-selection.ts`, via `senpi-task/src/category/resolver.ts`), one
// rung at a time, so a profile and a category can never disagree on provider spelling or on which
// registry id counts as "that model". The deps pin it to the availability branch: an empty registry
// is answered here, above, instead of letting the cold-cache branch guess a provider.
function matchRung(rung: ModelProfileRung, availableModels: ReadonlySet<string>): RungMatch | undefined {
  const selection = resolveModelForDelegateTask(
    {
      fallbackChain: [{ providers: [...rung.providers], model: rung.model }],
      availableModels,
    },
    { connectedProviders: null, hasProviderModelsCache: true, hasConnectedProvidersCache: true },
  )
  if (selection === undefined || !("model" in selection)) return undefined

  const separatorIndex = selection.model.indexOf("/")
  if (separatorIndex <= 0 || separatorIndex === selection.model.length - 1) return undefined
  return {
    provider: selection.model.slice(0, separatorIndex),
    modelId: selection.model.slice(separatorIndex + 1),
    ...(rung.reasoning !== undefined ? { reasoning: rung.reasoning } : {}),
  }
}

/**
 * Resolve the active `model_profile` against the live registry listing.
 *
 * Pure by construction: `availableModels` is the flat `provider/id` list, so the same call is unit
 * testable and the session-start component (`index.ts`) owns every side effect. This function is
 * the ONLY producer of the unknown-profile message.
 */
export function resolveModelProfile(input: ResolveModelProfileInput): ModelProfileResolution {
  const active = input.active.trim()
  const availableModels: ReadonlySet<string> = new Set(input.availableModels)

  // A value carrying a slash IS the pin: the tier and the pin share one key, so no second source of
  // truth exists and `settings.json` is never consulted for "the user pinned a model".
  if (active.includes("/")) {
    const profile: ModelProfileSummary = { id: active, displayName: active, source: "pin" }
    const match = availableModels.size === 0 ? undefined : matchRung(userRung(active), availableModels)
    return match === undefined
      ? { kind: "unavailable", profile, chain: [active] }
      : { kind: "resolved", profile, ...match, skipped: [] }
  }

  const profiles = mergeModelProfiles(input.profiles)
  const definition = Object.hasOwn(profiles, active) ? profiles[active] : undefined
  if (definition === undefined) {
    const known = Object.keys(profiles).sort()
    return { kind: "unknown", name: active, known, message: unknownProfileMessage(active, known) }
  }
  if (definition.models.length === 0) {
    return { kind: "empty", profile: definition.profile }
  }

  const skipped: string[] = []
  if (availableModels.size > 0) {
    for (const rung of definition.models) {
      const match = matchRung(rung, availableModels)
      if (match !== undefined) {
        return { kind: "resolved", profile: definition.profile, ...match, skipped }
      }
      skipped.push(formatRung(rung))
    }
  }
  return { kind: "unavailable", profile: definition.profile, chain: definition.models.map(formatRung) }
}
