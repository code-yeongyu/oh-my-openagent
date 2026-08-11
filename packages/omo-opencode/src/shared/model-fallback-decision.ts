import { isProviderExhaustionFallbackEligible, shouldRetryError } from "@oh-my-opencode/model-core"

export function shouldAttemptModelFallback(errorInfo: {
  name?: string
  message?: string
  statusCode?: number
}): boolean {
  return shouldRetryError(errorInfo) || isProviderExhaustionFallbackEligible(errorInfo)
}
