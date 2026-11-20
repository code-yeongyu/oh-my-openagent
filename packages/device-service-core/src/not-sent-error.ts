import { LocalApiError } from "./local-api/errors.ts"

// A failure before any session.command was written (the endpoint lookup an endpoint command makes first): nothing was
// dispatched, so a caller may treat it as refused and retry safely. The vendored LocalApiError has no such field.
export class NotSentError extends LocalApiError {
  readonly not_sent = true as const
}

export function markNotSent(error: unknown): unknown {
  if (error instanceof NotSentError) return error
  if (!(error instanceof LocalApiError)) return error
  return new NotSentError(error.code, error.reason, {
    action: error.action,
    ...(error.limit_chars === undefined ? {} : { limit_chars: error.limit_chars }),
    ...(error.path_refusal === undefined ? {} : { path_refusal: error.path_refusal }),
    ...(error.candidates === undefined ? {} : { candidates: error.candidates }),
    ...(error.incomplete === undefined ? {} : { incomplete: error.incomplete }),
    ...(error.sign_in_reason === undefined ? {} : { sign_in_reason: error.sign_in_reason }),
  })
}

/**
 * omo#13763: the refusal of a wake toward a device service below the wake minimum. It names the running version and the
 * minimum so an outdated service reads as one, never as a bare `unsupported`. A null minimum turns the wake off in
 * this build, so no service can carry it.
 */
export const olderThanWakeMinimum = (serviceVersion: string, minimum: string | null): NotSentError =>
  minimum === null
    ? new NotSentError("unsupported", "this omo build does not send the wake target")
    : new NotSentError("unsupported", `device service ${serviceVersion} is older than ${minimum}; update it`, {
        action: `Run omo remote bootstrap to install device service ${minimum} or later.`,
      })
