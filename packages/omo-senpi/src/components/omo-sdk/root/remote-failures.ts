import { REMOTE_CODES } from "../../remote/codes"
import type { RemoteFailure } from "../../remote/types"
import { OMO_CODE_REGISTRY, type OmoCode, type OmoFailure } from "../contract"
import { HELD_CODE } from "./thread-failures"

type RemoteCode = RemoteFailure["code"]

const isRegistered = (code: string): code is Exclude<OmoCode, "not_implemented"> =>
  Object.hasOwn(OMO_CODE_REGISTRY, code)
const isRemoteCode = (code: unknown): code is RemoteCode =>
  typeof code === "string" && (REMOTE_CODES as readonly string[]).includes(code)

// Design 4.4: the remote module's flat failure on the root. Its three extra fields are first-class on the root's shape
// and pass with their values; a code the registry holds without a producer rides under internal_error with the code in
// `details.$held_code`, exactly as a thread failure does, so the inverse restores the failure it was made from.
export function remoteFailure(failure: RemoteFailure): OmoFailure {
  const { kind: _kind, code, details, ...rest } = failure
  if (isRegistered(code))
    return { kind: "error", error: { code, ...rest, ...(details === undefined ? {} : { details }) } }
  return { kind: "error", error: { code: "internal_error", ...rest, details: { ...details, [HELD_CODE]: code } } }
}

export function remoteFailureOf(failure: OmoFailure): RemoteFailure {
  const { code, details, ...rest } = failure.error
  const held = details?.[HELD_CODE]
  if (code === "internal_error" && isRemoteCode(held)) {
    const { [HELD_CODE]: _held, ...kept } = details ?? {}
    return { kind: "error", code: held, ...rest, ...(Object.keys(kept).length === 0 ? {} : { details: kept }) }
  }
  return { kind: "error", code: code as RemoteCode, ...rest, ...(details === undefined ? {} : { details }) }
}
