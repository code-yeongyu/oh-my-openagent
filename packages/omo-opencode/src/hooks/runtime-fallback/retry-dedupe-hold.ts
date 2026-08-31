import { RUNTIME_FALLBACK_SEMANTIC_DEDUPE_MARGIN_MS } from "./constants"

type DedupeHoldConfig = {
  readonly timeout_seconds: number
}

type DedupeHoldOptions = {
  readonly session_timeout_ms?: number
}

export function resolveRuntimeFallbackDedupeHoldMs(
  config: DedupeHoldConfig,
  options?: DedupeHoldOptions,
): number | undefined {
  const effectiveTimeoutMs = options?.session_timeout_ms ?? config.timeout_seconds * 1000
  if (effectiveTimeoutMs <= 0) return undefined
  return effectiveTimeoutMs + RUNTIME_FALLBACK_SEMANTIC_DEDUPE_MARGIN_MS
}
