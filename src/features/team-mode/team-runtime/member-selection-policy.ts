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
  | { kind: "creative"; connectedProviders: string[] | null }

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
 * Filters a fallback chain to entries with at least one connected provider.
 * Pass null when no provider cache is available — in that case every entry
 * is treated as reachable (matches the cold-cache behavior of
 * resolveModelForDelegateTask).
 */
export function filterReachableChainEntries(
  chain: ReadonlyArray<FallbackEntry>,
  connectedProviders: ReadonlyArray<string> | null,
): FallbackEntry[] {
  if (connectedProviders === null) return [...chain]
  const connected = new Set(connectedProviders.map((provider) => provider.toLowerCase()))
  return chain.filter((entry) => entry.providers.some((provider) => connected.has(provider.toLowerCase())))
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
 * Picks the first connected provider for a chain entry, falling back to
 * the entry's first provider when the cache is unavailable.
 */
export function pickEntryProvider(input: {
  entry: FallbackEntry
  connectedProviders: ReadonlyArray<string> | null
}): string | undefined {
  const { entry, connectedProviders } = input
  if (entry.providers.length === 0) return undefined
  if (connectedProviders === null) return entry.providers[0]
  const connected = new Set(connectedProviders.map((provider) => provider.toLowerCase()))
  const match = entry.providers.find((provider) => connected.has(provider.toLowerCase()))
  return match ?? entry.providers[0]
}

/**
 * Every team member that gets a deliberate selection (whether through
 * stable seed broadcast, creative round-robin, or per-member override)
 * launches with this intent. The auto path is unreachable from team-mode
 * by design.
 */
export const TEAM_MEMBER_MODEL_INTENT: ModelIntent = "explicit"
