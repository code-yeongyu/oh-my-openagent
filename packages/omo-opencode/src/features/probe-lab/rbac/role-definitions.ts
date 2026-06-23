export type ProbeRole = "viewer" | "operator" | "admin"

const VIEWER_TOOLS: ReadonlyArray<string> = [
  "probe_capture_get",
  "probe_audit_log",
  "probe_metrics_get",
  "probe_alerts_evaluate",
  "probe_question_add",
  "probe_question_list",
  "probe_question_status",
  "probe_question_park",
  "probe_hypothesis_status",
  "probe_hypothesis_add",
  "probe_provider_health",
  "probe_experiment_status",
  "probe_fingerprint_matrix",
  "probe_fingerprint_verify",
]

const OPERATOR_ADDITIONS: ReadonlyArray<string> = [
  "probe_run",
  "probe_replay",
  "probe_replay_chain",
  "probe_capture_diff",
  "probe_hypothesis_evidence",
  "probe_experiment_create",
  "probe_experiment_run",
  "probe_experiment_abort",
  "probe_canary_lock",
  "probe_pool_burn_budget",
  "probe_provider_refresh",
  "probe_provider_bootstrap",
  "probe_credentials_auto_rotate",
  "probe_retention_run",
]

const ADMIN_ADDITIONS: ReadonlyArray<string> = [
  "probe_provider_register",
  "probe_provider_rotate",
  "probe_fingerprint_register",
  "probe_export",
  "probe_hypothesis_supersede",
  "probe_hypothesis_resurrect",
]

const VIEWER = new Set<string>(VIEWER_TOOLS)
const OPERATOR = new Set<string>([...VIEWER_TOOLS, ...OPERATOR_ADDITIONS])
const ADMIN = new Set<string>([...VIEWER_TOOLS, ...OPERATOR_ADDITIONS, ...ADMIN_ADDITIONS])

export const ROLE_PERMISSIONS: ReadonlyMap<ProbeRole, ReadonlySet<string>> = new Map<ProbeRole, ReadonlySet<string>>([
  ["viewer", VIEWER],
  ["operator", OPERATOR],
  ["admin", ADMIN],
])

export function isProbeRole(value: string): value is ProbeRole {
  return value === "viewer" || value === "operator" || value === "admin"
}
