import type { RespawnFailureCode, RespawnResult } from "../lifecycle/port"
import { RunnerError } from "../runners/in-process/runner-error"

export function classifyResumeFailure(error: unknown): RespawnResult {
  if (RunnerError.is(error)) {
    const { kind, message } = error.failure
    if (kind === "model_unavailable" || kind === "tools_unavailable" || kind === "session_unavailable") {
      return failure("retryable", kind, message)
    }
  }
  return failure("retryable", "respawn_failed", "in-process respawn failed")
}

// Both are waits the next reconcile retries: the store index could not be written (nothing was
// opened), or the recorded endpoint answers incompatibly (the session is never opened elsewhere).
export function hostRefusal(error: unknown): RespawnResult | undefined {
  if (!RunnerError.is(error) || error.failure.kind !== "host_unavailable") return undefined
  const { reason, message } = error.failure
  if (reason !== "store_index_unavailable" && reason !== "host_incompatible") return undefined
  return failure("retryable", reason, message)
}

export function isTeamRuntimeUnavailable(error: unknown): boolean {
  if (!(error instanceof Error) || error.name !== "TeamMemberRespawnLaunchError" || !("code" in error)) return false
  return error.code === "runtime_unavailable" || error.code === "runtime_inactive" ||
    error.code === "member_missing" || error.code === "task_mapping_mismatch"
}

export function failure(
  disposition: "retryable" | "unrecoverable",
  code: RespawnFailureCode,
  reason: string,
): RespawnResult {
  return { ok: false, disposition, code, reason }
}
