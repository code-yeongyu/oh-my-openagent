import type { FallbackEntry } from "../../../shared/model-requirements"
import type { DelegatedModelConfig, ModelIntent } from "../../../shared/model-resolution-types"
import type { MemberSelectionMode, TeamModeConfig } from "../../../config/schema/team-mode"
import type { TeamSpec } from "../types"

/**
 * Captured snapshot of the lead's resolved model that "stable" mode
 * broadcasts to followers without their own pick. The chain is
 * intentionally undefined on the broadcast — followers inherit the
 * model AND the sticky guarantee that the chain will not advance.
 */
export interface StableSeed {
  model: DelegatedModelConfig
}

export type MemberSelectionPolicy =
  | { kind: "stable" }
  | { kind: "creative"; connectedProviders: string[] | null; disabledProviders?: ReadonlyArray<string> }

/**
 * Resolves the effective `member_selection` mode by precedence:
 * call argument > TeamSpec field > global config > default "stable".
 */
export function resolveMemberSelectionMode(input: {
  callArg?: MemberSelectionMode
  spec: Pick<TeamSpec, "member_selection">
  config: Pick<TeamModeConfig, "member_selection">
}): MemberSelectionMode {
  if (input.callArg !== undefined) return input.callArg
  if (input.spec.member_selection !== undefined) return input.spec.member_selection
  return input.config.member_selection
}

/**
 * Filters a fallback chain to entries with at least one reachable provider.
 *
 * An entry is reachable only if it has at least one provider that is NOT in
 * disabledProviders. When connectedProviders is null (cold cache) every
 * non-all-disabled entry is treated as reachable. When connectedProviders is
 * provided the entry must additionally have at least one provider that is
 * BOTH connected AND not disabled.
 *
 * Default disabledProviders is an empty array — callers without the param
 * see identical behaviour to the previous two-argument form.
 */
export function filterReachableChainEntries(
  chain: ReadonlyArray<FallbackEntry>,
  connectedProviders: ReadonlyArray<string> | null,
  disabledProviders: ReadonlyArray<string> = [],
): FallbackEntry[] {
  const disabled = new Set(disabledProviders.map((p) => p.toLowerCase()))
  // Exclude entries where every provider is disabled.
  const active = disabled.size === 0
    ? [...chain]
    : chain.filter((entry) => entry.providers.some((p) => !disabled.has(p.toLowerCase())))
  if (connectedProviders === null) return active
  const connected = new Set(connectedProviders.map((provider) => provider.toLowerCase()))
  return active.filter((entry) =>
    entry.providers.some((p) => connected.has(p.toLowerCase()) && !disabled.has(p.toLowerCase()))
  )
}

/**
 * Round-robin index pick. Returns the entry at `index % length`. Returns
 * undefined when the chain is empty so callers can surface a clear error
 * instead of silently collapsing to a default.
 */
export function pickCreativeChainEntry(
  chain: ReadonlyArray<FallbackEntry>,
  index: number,
): FallbackEntry | undefined {
  if (chain.length === 0) return undefined
  if (index < 0) return undefined
  return chain[index % chain.length]
}

/**
 * Converts a FallbackEntry into a partial DelegatedModelConfig (the
 * caller is responsible for picking a concrete provider; this helper
 * just maps the entry's tuning fields onto the config shape).
 */
export function fallbackEntryToModelConfig(input: {
  entry: FallbackEntry
  providerID: string
}): DelegatedModelConfig {
  const { entry, providerID } = input
  return {
    providerID,
    modelID: entry.model,
    ...(entry.variant !== undefined ? { variant: entry.variant } : {}),
    ...(entry.reasoningEffort !== undefined ? { reasoningEffort: entry.reasoningEffort } : {}),
    ...(entry.temperature !== undefined ? { temperature: entry.temperature } : {}),
    ...(entry.top_p !== undefined ? { top_p: entry.top_p } : {}),
    ...(entry.maxTokens !== undefined ? { maxTokens: entry.maxTokens } : {}),
    ...(entry.thinking !== undefined ? { thinking: entry.thinking } : {}),
  }
}

/**
 * Picks the best available provider for a chain entry, respecting both the
 * connected-provider cache and the disabled-providers list.
 *
 * Cold cache (connectedProviders === null): returns the first provider that
 * is NOT in disabledProviders. Returns undefined when every provider is
 * disabled.
 *
 * Warm cache: returns the first provider that is BOTH connected AND not
 * disabled. Falls back to the first non-disabled provider (preserving the
 * existing best-effort behaviour when all connected providers are disabled).
 * Returns undefined when every provider is disabled.
 *
 * Default disabledProviders is an empty array — callers without the param
 * see identical behaviour to the previous two-argument form.
 */
export function pickEntryProvider(input: {
  entry: FallbackEntry
  connectedProviders: ReadonlyArray<string> | null
  disabledProviders?: ReadonlyArray<string>
}): string | undefined {
  const { entry, connectedProviders, disabledProviders = [] } = input
  if (entry.providers.length === 0) return undefined
  const disabled = new Set(disabledProviders.map((p) => p.toLowerCase()))
  if (connectedProviders === null) {
    // Cold cache: pick first non-disabled provider.
    return entry.providers.find((p) => !disabled.has(p.toLowerCase()))
  }
  const connected = new Set(connectedProviders.map((provider) => provider.toLowerCase()))
  // Warm cache: prefer first provider that is connected AND non-disabled.
  const match = entry.providers.find((p) => connected.has(p.toLowerCase()) && !disabled.has(p.toLowerCase()))
  // Best-effort: first non-disabled provider (same safety net as before for non-connected entries).
  return match ?? entry.providers.find((p) => !disabled.has(p.toLowerCase()))
}

/**
 * Every team member that gets a deliberate selection (whether through
 * stable seed broadcast, creative round-robin, or per-member override)
 * launches with this intent. The auto path is unreachable from team-mode
 * by design.
 */
export const TEAM_MEMBER_MODEL_INTENT: ModelIntent = "explicit"
