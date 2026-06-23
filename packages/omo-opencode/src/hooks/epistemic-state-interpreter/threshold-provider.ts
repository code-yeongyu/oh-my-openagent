import type { EpistemicThresholds } from "../../config/schema/epistemic-thresholds"
import { log } from "../../shared/logger"

export interface ResolvedThresholds {
  N: number
  M: number
  K: number
  T: number
}

export const DEFAULT_THRESHOLDS: ResolvedThresholds = {
  N: 3,
  M: 5,
  K: 10,
  T: 50,
}

export function resolveThresholds(config?: { epistemic_thresholds?: EpistemicThresholds }): ResolvedThresholds {
  const raw = config?.epistemic_thresholds
  if (!raw) return DEFAULT_THRESHOLDS

  if (raw.m < raw.n || raw.k < raw.m) {
    log("[epistemic] invalid threshold config (m >= n and k >= m required) - using defaults", raw)
    return DEFAULT_THRESHOLDS
  }

  return { N: raw.n, M: raw.m, K: raw.k, T: raw.t }
}
