import { extractSessionErrorInfo } from "../shared/session-error-info"
import { isTokenLimitError, isUnrecoverableRequestError } from "../todo-continuation-enforcer"
import { isAbortError } from "./is-abort-error"

export interface SessionErrorClassification {
  info: ReturnType<typeof extractSessionErrorInfo>
  isAbort: boolean
  isTokenLimit: boolean
  isUnrecoverable: boolean
}

/**
 * Classify an opencode `session.error` payload for the boulder continuation gate.
 *
 * Mirrors the #6109 classification order from `todo-continuation-enforcer/handler.ts`:
 * abort first, then token limit, then non-retryable request errors (for example the
 * Anthropic 400 raised when a compaction request carries a `tool_use` block without its
 * `tool_result`). Re-injecting a continuation after the latter two rebuilds the same
 * doomed request, so the loop must stop instead of retrying.
 */
export function classifySessionError(error: unknown): SessionErrorClassification {
  const info = extractSessionErrorInfo(error)
  if (isAbortError(error)) {
    return { info, isAbort: true, isTokenLimit: false, isUnrecoverable: false }
  }
  const isTokenLimit = isTokenLimitError(info)
  return {
    info,
    isAbort: false,
    isTokenLimit,
    isUnrecoverable: !isTokenLimit && isUnrecoverableRequestError(error),
  }
}
