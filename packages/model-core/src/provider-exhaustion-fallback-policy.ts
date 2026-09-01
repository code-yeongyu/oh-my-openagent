import { classifyRuntimeFallbackError, type RuntimeFallbackErrorType } from "./runtime-fallback-error-classifier"

export type ProviderExhaustionFallbackSignal = Extract<RuntimeFallbackErrorType, "quota_exceeded">

export function classifyProviderExhaustionFallbackSignal(
  error: unknown,
): ProviderExhaustionFallbackSignal | undefined {
  const runtimeFallbackErrorType = classifyRuntimeFallbackError(error)
  return runtimeFallbackErrorType === "quota_exceeded" ? runtimeFallbackErrorType : undefined
}

export function isProviderExhaustionFallbackEligible(error: unknown): boolean {
  return classifyProviderExhaustionFallbackSignal(error) !== undefined
}
