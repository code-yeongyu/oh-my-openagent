export type OmoErrorCode =
  | "signed_out"
  | "session_ended"
  | "desktop_sign_in"
  | "credential_store_locked"
  | "credential_store_unavailable"
  | "service_unreachable"
  | "service_refused"
  | "device_service_unavailable"
  | "unknown_path"
  | "session_not_found"
  | "internal_error"

export type OmoError = {
  readonly code: OmoErrorCode
  readonly message: string
  readonly next_action: string
  readonly details?: Readonly<Record<string, unknown>>
}

/** Every SDK call answers data in the shape thread tool results use; nothing is thrown at the caller. */
export type OmoResult<T> =
  { readonly kind: "ok"; readonly value: T } | { readonly kind: "error"; readonly error: OmoError }

export const ok = <T>(value: T): OmoResult<T> => ({ kind: "ok", value })

export const refused = <T>(
  code: OmoErrorCode,
  message: string,
  next_action: string,
  details?: Readonly<Record<string, unknown>>,
): OmoResult<T> => ({
  kind: "error",
  error: { code, message, next_action, ...(details === undefined ? {} : { details }) },
})
