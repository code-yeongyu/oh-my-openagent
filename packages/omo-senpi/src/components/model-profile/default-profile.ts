import { DEFAULT_MODEL_PROFILE_ORDER } from "./builtin-profiles"
import type { AuthFailure } from "./request-auth"
import type { ModelProfileResolution } from "./resolve"

export type ProbeState = {
  readonly excludedProviders: Set<string>
  readonly excludedSelectors: Set<string>
  readonly failures: AuthFailure[]
}

/**
 * One credential-probe state per session start: the default walk tries several lanes, and a
 * provider whose credentials already failed is neither probed again nor reported twice.
 */
export const newProbeState = (): ProbeState => ({
  excludedProviders: new Set(),
  excludedSelectors: new Set(),
  failures: [],
})

/**
 * The unset default (#10029): tries each lane in `DEFAULT_MODEL_PROFILE_ORDER` through the
 * caller's resolver (which probes credentials) and returns the first that resolves. When none
 * does, the first lane's result is returned, so the notice names Daily · Normal.
 */
export async function resolveDefaultModelProfile<T extends { readonly resolution: ModelProfileResolution }>(
  resolveFor: (profileId: string) => Promise<T>,
): Promise<T> {
  const [first, ...rest] = DEFAULT_MODEL_PROFILE_ORDER
  const primary = await resolveFor(first)
  if (primary.resolution.kind === "resolved") return primary
  for (const profileId of rest) {
    const candidate = await resolveFor(profileId)
    if (candidate.resolution.kind === "resolved") return candidate
  }
  return primary
}
