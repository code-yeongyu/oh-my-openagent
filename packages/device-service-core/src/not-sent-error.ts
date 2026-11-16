import { LocalApiError } from "./local-api/errors.ts"

// A failure before any session.command was written (the endpoint lookup an endpoint command makes first): nothing was
// dispatched, so a caller may treat it as refused and retry safely. The vendored LocalApiError has no such field.
export class NotSentError extends LocalApiError {
  readonly not_sent = true as const
}

export const markNotSent = (error: unknown): unknown =>
  error instanceof LocalApiError
    ? new NotSentError(error.code, error.reason, {
        action: error.action,
        ...(error.limit_chars === undefined ? {} : { limit_chars: error.limit_chars }),
        ...(error.path_refusal === undefined ? {} : { path_refusal: error.path_refusal }),
        ...(error.candidates === undefined ? {} : { candidates: error.candidates }),
        ...(error.incomplete === undefined ? {} : { incomplete: error.incomplete }),
        ...(error.sign_in_reason === undefined ? {} : { sign_in_reason: error.sign_in_reason }),
      })
    : error
