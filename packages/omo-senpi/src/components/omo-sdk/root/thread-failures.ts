import type { ThreadToolFailure } from "../../thread/errors"
import { OMO_CODE_REGISTRY, type OmoCode, type OmoFailure } from "../contract"
import { carriesReservedKey, RESTORE_KEY, restored, restoreOf, withRestore } from "./restore"

const isRegistered = (code: string): code is Exclude<OmoCode, "not_implemented"> =>
  Object.hasOwn(OMO_CODE_REGISTRY, code)

const THREAD_SHAPE = ["code", "message", "next_action", "details"]

/** A producer's failure that already holds the reserved key is refused, never read as restore data. */
export const reservedKeyRefusal = (): OmoFailure => ({
  kind: "error",
  error: {
    code: "internal_error",
    message: `A failure reached the SDK with the reserved details key ${RESTORE_KEY}; it was not converted.`,
    next_action: "Report this as a bug in the omo SDK.",
  },
})

/**
 * A thread core failure on the root (design 4.4): a registered code passes as it is; a code the registry lacks rides
 * under internal_error, and anything beyond the root's shape rides in the reserved key (restore.ts), so the facade's
 * answer after the inverse is the core's own, field for field.
 */
export function threadFailure(error: ThreadToolFailure): OmoFailure {
  if (carriesReservedKey(error.details)) return reservedKeyRefusal()
  const held = isRegistered(error.code) ? undefined : error.code
  const details = withRestore(error, THREAD_SHAPE, held)
  return {
    kind: "error",
    error: {
      code: held === undefined ? (error.code as Exclude<OmoCode, "not_implemented">) : "internal_error",
      message: error.message,
      next_action: error.next_action,
      ...(details === undefined ? {} : { details }),
    },
  }
}

/** The inverse of threadFailure: the thread failure a root failure was made from, so the thread facade answers it as it did. */
export function threadToolFailureOf(failure: OmoFailure): ThreadToolFailure {
  const { code, message, next_action, details } = failure.error
  const fields = { code, message, next_action, ...(details === undefined ? {} : { details }) }
  return restored(fields, restoreOf(details)) as ThreadToolFailure
}

/** A thread result on the root: its ok branch as the thread contract has it, its error branch in the root's one shape. */
export function onRoot<Result extends { readonly kind: string }>(
  result: Result,
): Exclude<Result, { readonly kind: "error" }> | OmoFailure {
  if (result.kind !== "error") return result as Exclude<Result, { readonly kind: "error" }>
  return threadFailure((result as unknown as { readonly error: ThreadToolFailure }).error)
}
