import type { RemoteFailure } from "../../remote/types"
import { OMO_CODE_REGISTRY, type OmoCode, type OmoFailure } from "../contract"
import { carriesReservedKey, restored, restoreOf, withRestore } from "./restore"
import { reservedKeyRefusal } from "./thread-failures"

const isRegistered = (code: string): code is Exclude<OmoCode, "not_implemented"> =>
  Object.hasOwn(OMO_CODE_REGISTRY, code)

const REMOTE_SHAPE = ["kind", "code", "message", "next_action", "uncertain", "command_id", "partial", "details"]

// Design 4.4: the remote module's flat failure on the root. Its three extra fields are first-class on the root's shape
// and pass with their values; what the shape cannot hold rides in the reserved key (restore.ts), as for a thread failure.
export function remoteFailure(failure: RemoteFailure): OmoFailure {
  if (carriesReservedKey(failure.details)) return reservedKeyRefusal()
  const held = isRegistered(failure.code) ? undefined : failure.code
  const details = withRestore(failure, REMOTE_SHAPE, held)
  const { uncertain, command_id, partial } = failure
  return {
    kind: "error",
    error: {
      code: held === undefined ? (failure.code as Exclude<OmoCode, "not_implemented">) : "internal_error",
      message: failure.message,
      next_action: failure.next_action,
      ...(uncertain === undefined ? {} : { uncertain }),
      ...(command_id === undefined ? {} : { command_id }),
      ...("partial" in failure ? { partial } : {}),
      ...(details === undefined ? {} : { details }),
    },
  }
}

export function remoteFailureOf(failure: OmoFailure): RemoteFailure {
  const { code, details, ...rest } = failure.error
  const fields = { kind: "error", code, ...rest, ...(details === undefined ? {} : { details }) }
  return restored(fields, restoreOf(details)) as RemoteFailure
}
