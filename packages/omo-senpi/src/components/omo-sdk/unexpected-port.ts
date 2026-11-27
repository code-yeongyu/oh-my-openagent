// The one local logger port of the SDK (security ruling B8): where an exception no rule expected goes, the only place its
// text may go. It is a leaf module, imported by the root and by the thread core alike, so naming it never pulls the thread
// core onto the root's static import path (slice P1c, #15031).

/**
 * Where a surface records an unexpected exception. A port that wrote it to a local file answers that file's path, which the
 * fixed message then names; `false` when it keeps a file it could not write; anything else names nothing.
 */
export type UnexpectedPort = (error: unknown) => unknown

export const UNEXPECTED_LOG_UNWRITTEN = " Its details could not be written to the local log."

export const unexpectedLogNamed = (path: string): string => ` The details are in ${path}.`

/** Hands an exception to the logger port, isolated from the outcome: a port that throws changes no answer and no receipt. */
export function reportUnexpected(onUnexpected: UnexpectedPort | undefined, error: unknown): string | false | undefined {
  try {
    // Never awaited: a port that hangs holds nothing; one that rejects is caught here, never an unhandled rejection.
    const answered: unknown = onUnexpected?.(error)
    if (answered instanceof Promise) answered.catch(() => undefined)
    if (answered === false) return false
    return typeof answered === "string" && answered !== "" ? answered : undefined
  } catch {
    // The port's own failure is dropped on purpose (reporting it would need the very sink that just failed).
    return undefined
  }
}

export function withUnexpectedLog(message: string, written: string | false | undefined): string {
  if (written === undefined) return message
  return written === false ? `${message}${UNEXPECTED_LOG_UNWRITTEN}` : `${message}${unexpectedLogNamed(written)}`
}
