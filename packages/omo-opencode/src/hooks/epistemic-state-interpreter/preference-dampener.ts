import type { DampenedPreference } from "./preference-types"

const MAX_DELTA = 0.2

export function dampenPreference(
  ruleId: string,
  previous: number,
  proposed: number
): DampenedPreference {
  const delta = proposed - previous
  const clampedDelta = Math.max(-MAX_DELTA, Math.min(MAX_DELTA, delta))
  const applied = previous + clampedDelta
  return { ruleId, previous, proposed, applied }
}
