/** Reason a byte string is not acceptable canonical JSON for signing. */
export type CanonicalJsonViolation =
  | "json"
  | "duplicate-key"
  | "number"
  | "order"
  | "escape"
  | "whitespace"
  | "encoding"

export class CanonicalJsonError extends Error {
  readonly name = "CanonicalJsonError"
  constructor(
    readonly violation: CanonicalJsonViolation,
    message: string,
  ) {
    super(message)
  }
}

/** The JSON value domain the canonicalizer walks: plain data, no undefined/functions. */
export type CanonicalJsonValue = null | boolean | number | string | CanonicalJsonValue[] | { [key: string]: CanonicalJsonValue }
