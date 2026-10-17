import { RunnerError } from "../in-process/runner-error"
import { HostUnavailableError, isHostIncompatible } from "./daemon"
import type { HostNoticeKind } from "./host-notice"

/**
 * A RECORDED endpoint is where the child's retained session lives, so nothing the ensure or the
 * open answers there may send the child to the per-child fallback: an incompatible host parks it
 * (`host_incompatible`), anything else fails closed with its own reason.
 */
export function recordedEndpointFailure(
  notice: (kind: HostNoticeKind, detail?: string) => void,
  error: unknown,
  socket: string | undefined,
): RunnerError {
  if (isHostIncompatible(error)) {
    notice("host_incompatible", socket)
    return new RunnerError({
      kind: "host_unavailable",
      reason: "host_incompatible",
      message: error instanceof Error ? error.message : String(error),
      cause: error,
    })
  }
  return new RunnerError({
    kind: "host_unavailable",
    message: error instanceof Error ? error.message : String(error),
    reason: error instanceof HostUnavailableError ? error.reason : "host_unreachable",
    cause: error,
  })
}
