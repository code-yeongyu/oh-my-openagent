import { THREAD_ERROR_CODES, type ThreadErrorCode, type ThreadToolFailure } from "../../thread/errors"
import { OMO_CODE_REGISTRY, type OmoCode, type OmoFailure } from "../contract"

const isRegistered = (code: string): code is Exclude<OmoCode, "not_implemented"> =>
  Object.hasOwn(OMO_CODE_REGISTRY, code)

/**
 * A thread core failure on the root (design 4.4). Every code the thread core produces is in the registry and passes
 * unchanged, details included; a code held with no producer (contract/codes.ts HELD_CODES) is never expected here, and
 * if one appears it is kept in `details.code` under internal_error rather than typed as a code the registry lacks.
 */
export function threadFailure(error: ThreadToolFailure): OmoFailure {
  if (isRegistered(error.code)) return { kind: "error", error: { ...error, code: error.code } }
  return {
    kind: "error",
    error: {
      code: "internal_error",
      message: error.message,
      next_action: error.next_action,
      details: { ...error.details, code: error.code },
    },
  }
}

const isThreadCode = (code: unknown): code is ThreadErrorCode =>
  typeof code === "string" && (THREAD_ERROR_CODES as readonly string[]).includes(code)

/** The inverse of threadFailure: the thread failure a root failure was made from, so the thread facade answers it as it did. */
export function threadToolFailureOf(failure: OmoFailure): ThreadToolFailure {
  const { code, message, next_action, details } = failure.error
  const held = details?.["code"]
  if (code === "internal_error" && isThreadCode(held)) {
    const { code: _held, ...rest } = details ?? {}
    return { code: held, message, next_action, ...(Object.keys(rest).length === 0 ? {} : { details: rest }) }
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
