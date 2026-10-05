// Vendored persisted-reason contract from the rollback target R0 (the #9027 merge on dev, commit ebd01f84e):
// - packages/senpi-task/src/state/types.ts
// - packages/senpi-task/src/state/start-failure.ts

export const R0_SOURCE_COMMIT = "ebd01f84e"

export const R0_SUSPENSION_REASONS = [
  "daemon_unavailable",
  "host_draining",
] as const

export const R0_MODEL_START_FAILURE_REASONS = [
  "model_not_in_child_profile",
  "catalog_probe_timed_out",
  "catalog_probe_failed",
] as const

export const R0_HOST_START_FAILURE_REASONS = [
  "protocol",
  "capability",
  "engine_mismatch",
  "engine_refused",
  "win32",
  "runtime",
  "host_unreachable",
  "ensure_failed",
  "ensure_timed_out",
] as const

export const R0_SESSION_START_FAILURE_REASONS = [
  "open_timed_out",
  "session_path_in_use",
  "session_reservation_limit",
  "invalid_path",
  "open_failed",
  "invalid_session_context",
  "invalid_session_kind",
  "invalid_launch_profile",
  "invalid_session_id",
  "session_id_in_use",
  "host_memory_pressure",
  "host_draining",
] as const

export const R0_TASK_START_FAILURE_REASONS = [
  ...R0_MODEL_START_FAILURE_REASONS,
  ...R0_HOST_START_FAILURE_REASONS,
  ...R0_SESSION_START_FAILURE_REASONS,
] as const

const suspensionReasons = new Set<string>(R0_SUSPENSION_REASONS)
const failureReasons = new Set<string>(R0_TASK_START_FAILURE_REASONS)

export function parseR0PersistedReasons(record: Record<string, unknown>): void {
  const suspensionReason = record["suspension_reason"]
  if (suspensionReason !== undefined && !suspensionReasons.has(String(suspensionReason))) {
    throw new Error(`R0 rejects suspension_reason ${String(suspensionReason)}`)
  }
  const failureReason = record["failure_reason"]
  if (failureReason !== undefined && !failureReasons.has(String(failureReason))) {
    throw new Error(`R0 rejects failure_reason ${String(failureReason)}`)
  }
}
