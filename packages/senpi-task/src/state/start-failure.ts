export const TASK_START_FAILURE_KINDS = [
  "suspended_unresumable",
  "child-prompt-failed",
  "child-turn-failed",
  "session-create-failed",
  "depth-exceeded",
  "model_unavailable",
  "tools_unavailable",
  "session_unavailable",
  "host_unavailable",
] as const

export type TaskStartFailureKind = (typeof TASK_START_FAILURE_KINDS)[number]

export const MODEL_START_FAILURE_REASONS = [
  "model_not_in_child_profile",
  "catalog_probe_timed_out",
  "catalog_probe_failed",
] as const

export const HOST_START_FAILURE_REASONS = [
  "protocol",
  "capability",
  "engine_mismatch",
  "engine_refused",
  "win32",
  "runtime",
  "host_unreachable",
  "ensure_failed",
  "ensure_timed_out",
  "shard_socket_too_long",
  "shard_alt_root_unsafe",
  "legacy_host",
  "host_incompatible",
  "store_index_unavailable",
  "own_host_unreachable",
  "shard_identity_missing",
  "host_busy",
  "launch_spec_insecure",
] as const

export const SESSION_START_FAILURE_REASONS = [
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

export const TASK_START_FAILURE_REASONS = [
  ...MODEL_START_FAILURE_REASONS,
  ...HOST_START_FAILURE_REASONS,
  ...SESSION_START_FAILURE_REASONS,
] as const

export type TaskStartFailureReason = (typeof TASK_START_FAILURE_REASONS)[number]

export type TaskStartFailureRecordFields = {
  readonly failure_kind?: TaskStartFailureKind
  readonly failure_reason?: TaskStartFailureReason
}

export type TaskStartFailureTransition<RunStats> = TaskStartFailureRecordFields & {
  readonly type: "fail"
  readonly timestamp: string
  readonly error_message: string
  readonly killed?: boolean
  readonly run_stats?: RunStats
}

const taskStartFailureReasons = new Set<string>(TASK_START_FAILURE_REASONS)
const taskStartFailureKinds = new Set<string>(TASK_START_FAILURE_KINDS)

export function isTaskStartFailureKind(value: unknown): value is TaskStartFailureKind {
  return typeof value === "string" && taskStartFailureKinds.has(value)
}

export function isTaskStartFailureReason(value: unknown): value is TaskStartFailureReason {
  return typeof value === "string" && taskStartFailureReasons.has(value)
}
