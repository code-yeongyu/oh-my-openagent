// Persisted vocabulary of the rollback target R0 (the #9027 merge on dev, commit ebd01f84e).
// Rollback preparation may remove only values outside these closed sets.
export const R0_SUSPENSION_REASONS = [
  "daemon_unavailable",
  "host_draining",
] as const

export const R0_FAILURE_REASONS = [
  "model_not_in_child_profile",
  "catalog_probe_timed_out",
  "catalog_probe_failed",
  "protocol",
  "capability",
  "engine_mismatch",
  "engine_refused",
  "win32",
  "runtime",
  "host_unreachable",
  "ensure_failed",
  "ensure_timed_out",
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
