export function extractPromptFailureMessage(error: unknown): string {
  if (typeof error === "string") return error
  if (error instanceof Error) return error.message
  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>
    if (typeof record.message === "string") return record.message
    try {
      return JSON.stringify(error)
    } catch (stringifyError) {
      stringifyError instanceof Error
      return ""
    }
  }
  return String(error)
}

const VERIFICATION_INDEPENDENT_AMBIGUOUS_PATTERNS = [
  "unexpected eof",
  "json parse error",
  "unexpected end of json input",
] as const

const VERIFICATION_DEPENDENT_AMBIGUOUS_PATTERNS = [
  "timed out",
] as const

function promptFailureMessageMatches(error: unknown, patterns: readonly string[]): boolean {
  const message = extractPromptFailureMessage(error).toLowerCase()
  return patterns.some((pattern) => message.includes(pattern))
}

export function isAmbiguousPromptDispatchFailure(error: unknown): boolean {
  return promptFailureMessageMatches(error, [
    ...VERIFICATION_INDEPENDENT_AMBIGUOUS_PATTERNS,
    ...VERIFICATION_DEPENDENT_AMBIGUOUS_PATTERNS,
  ])
}

// Excludes timeouts: a dispatch timeout almost always means the prompt was NOT
// accepted, so callers that cannot verify acceptance must treat it as a failure.
export function isVerificationIndependentAmbiguousPromptDispatchFailure(error: unknown): boolean {
  return promptFailureMessageMatches(error, VERIFICATION_INDEPENDENT_AMBIGUOUS_PATTERNS)
}

type PromptDispatchFailureResultLike = {
  status: "failed"
  error: unknown
  dispatchAttempted?: boolean
}

// Default classification for callers WITHOUT post-dispatch verification: a
// timeout is treated as a real failure, only genuinely indeterminate errors
// (EOF / JSON parse) are considered possibly-accepted.
export function isAmbiguousPostDispatchPromptFailure(result: PromptDispatchFailureResultLike): boolean {
  return result.dispatchAttempted === true
    && isVerificationIndependentAmbiguousPromptDispatchFailure(result.error)
}

// For callers that verify post-dispatch acceptance (e.g. parent-wake via
// hasRecordedPromptAfterDispatch): timeouts remain ambiguous so the caller can
// confirm delivery before retrying instead of risking a duplicate dispatch.
export function isVerifiableAmbiguousPromptFailure(result: PromptDispatchFailureResultLike): boolean {
  return result.dispatchAttempted === true && isAmbiguousPromptDispatchFailure(result.error)
}
