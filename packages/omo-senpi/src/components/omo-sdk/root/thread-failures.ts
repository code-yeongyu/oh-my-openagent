import { THREAD_ERROR_CODES, type ThreadErrorCode, type ThreadToolFailure } from "../../thread/errors"
import { OMO_CODE_REGISTRY, type OmoCode, type OmoFailure } from "../contract"

/** Where a code the registry lacks rides on the root's failure; the inverse reads only this key. */
export const HELD_CODE = "$held_code"

/** The reserved key's value: the code the registry lacks, and whether the original failure carried details. */
export const heldOf = (
  details: Readonly<Record<string, unknown>> | undefined,
): { readonly code: string; readonly details: boolean } | undefined => {
  const held = details?.[HELD_CODE] as { code?: unknown; details?: unknown } | undefined
  return typeof held?.code === "string" && typeof held.details === "boolean"
    ? { code: held.code, details: held.details }
    : undefined
}

export const carriesReservedKey = (details: Readonly<Record<string, unknown>> | undefined): boolean =>
  details !== undefined && Object.hasOwn(details, HELD_CODE)

/** A producer's failure that already holds the reserved key is refused, never read as a held code. */
export const reservedKeyRefusal = (): OmoFailure => ({
  kind: "error",
  error: {
    code: "internal_error",
    message: `A failure reached the SDK with the reserved details key ${HELD_CODE}; it was not converted.`,
    next_action: "Report this as a bug in the omo SDK.",
  },
})

const isRegistered = (code: string): code is Exclude<OmoCode, "not_implemented"> =>
  Object.hasOwn(OMO_CODE_REGISTRY, code)

/**
 * A thread core failure on the root (design 4.4). Every code the thread core produces is in the registry and passes
 * unchanged, details included; a code held with no producer (contract/codes.ts HELD_CODES) is never expected here, and
 * if one appears it rides under internal_error with the code (and whether it had details) in `details.$held_code`, a key a producer's
 * failure may not carry, so a
 * `details.code` a failure legitimately carries is never read as the marker.
 */
export function threadFailure(error: ThreadToolFailure): OmoFailure {
  if (carriesReservedKey(error.details)) return reservedKeyRefusal()
  if (isRegistered(error.code)) return { kind: "error", error: { ...error, code: error.code } }
  return {
    kind: "error",
    error: {
      code: "internal_error",
      message: error.message,
      next_action: error.next_action,
      details: { ...error.details, [HELD_CODE]: { code: error.code, details: error.details !== undefined } },
    },
  }
}

const isThreadCode = (code: unknown): code is ThreadErrorCode =>
  typeof code === "string" && (THREAD_ERROR_CODES as readonly string[]).includes(code)

/** The inverse of threadFailure: the thread failure a root failure was made from, so the thread facade answers it as it did. */
export function threadToolFailureOf(failure: OmoFailure): ThreadToolFailure {
  const { code, message, next_action, details } = failure.error
  const held = heldOf(details)
  if (code === "internal_error" && held !== undefined && isThreadCode(held.code)) {
    const { [HELD_CODE]: _held, ...rest } = details ?? {}
    return { code: held.code, message, next_action, ...(held.details ? { details: rest } : {}) }
  }
  return { code: code as ThreadErrorCode, message, next_action, ...(details === undefined ? {} : { details }) }
}

/** A thread result on the root: its ok branch as the thread contract has it, its error branch in the root's one shape. */
export function onRoot<Result extends { readonly kind: string }>(
  result: Result,
): Exclude<Result, { readonly kind: "error" }> | OmoFailure {
  if (result.kind !== "error") return result as Exclude<Result, { readonly kind: "error" }>
  return threadFailure((result as unknown as { readonly error: ThreadToolFailure }).error)
}
