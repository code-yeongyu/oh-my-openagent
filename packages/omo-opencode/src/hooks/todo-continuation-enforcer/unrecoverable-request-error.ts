import { getRuntimeFallbackRetryableSignal, getRuntimeFallbackStatusCode } from "@oh-my-opencode/model-core"

const UNRECOVERABLE_REQUEST_STATUS_CODES = new Set([400, 422])

/**
 * A malformed-request error the provider will reject identically on every retry, for
 * example the Anthropic 400 raised when a compaction request carries a `tool_use`
 * block without its `tool_result`. Re-injecting a continuation directive after one of
 * these rebuilds the same request and wedges the session, so the loop must stop.
 * Deliberately narrow: only a request-shape status code paired with an explicit
 * `isRetryable: false` from the provider counts.
 */
export function isUnrecoverableRequestError(error: unknown): boolean {
  if (!error) {
    return false
  }

  const statusCode = getRuntimeFallbackStatusCode(error)
  if (statusCode === undefined || !UNRECOVERABLE_REQUEST_STATUS_CODES.has(statusCode)) {
    return false
  }

  return getRuntimeFallbackRetryableSignal(error) === false
}
