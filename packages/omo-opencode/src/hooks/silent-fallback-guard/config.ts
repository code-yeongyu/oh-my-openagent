import type { SilentFallbackGuardConfig } from "./types"

export function defaultSilentFallbackGuardConfig(): SilentFallbackGuardConfig {
  return {
    enabled: false,
    mode: "report",
    maxReviewCandidates: 20,
    maxPerFile: 5,
    maxPerRiskType: 8,
    includeLowConfidence: false,
    supportedLanguages: ["javascript", "typescript", "python"],
  }
}

export function resolveSilentFallbackGuardConfig(
  input?: Partial<SilentFallbackGuardConfig>,
): SilentFallbackGuardConfig {
  return {
    ...defaultSilentFallbackGuardConfig(),
    ...input,
  }
}
