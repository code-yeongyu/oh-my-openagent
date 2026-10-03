export const SCENARIO_IDS = [
  "topology_two_parent_shards",
  "host_crash_isolated",
  "crashed_shard_reattaches",
  "all_six_children_complete",
  "grandchild_reuses_tree_shard",
  "mixed_engine_host_spawns_shard",
  "nested_spawn_attach_only",
  "own_endpoint_unreachable_fails_closed",
  "handoff_nested_spawn_uses_successor",
  "interactive_handoff_nested_spawn",
  "alt_root_handoff_parent_and_thread",
  "nested_resume_attach_only",
  "rollback_live_endpoint_refused",
  "rollback_drain_wait_gate",
  "rollback_three_store_migration",
  "rollback_r0_resume",
  "rollback_without_prepare_parks",
  "cross_endpoint_open_hazard",
  "idle_gc_index_resume",
  "store_index_registration_precondition",
  "store_index_registration_precondition_auto",
  "retain_idle_resume",
  "retain_midturn_continuation",
  "migration_recorded_socket_wins",
  "incompatibility_and_entry_fault_isolation",
]

export const CONTROL_ID = "shared_host_cascade_reproduced"

function verdictFor(id, row) {
  const evidence = Array.isArray(row?.evidence) ? row.evidence.filter((value) => typeof value === "string" && value.length > 0) : []
  const pass = row?.status === "pass" && evidence.length > 0
  return {
    id,
    verdict: pass ? "PASS" : "FAIL",
    evidence,
    ...(typeof row?.reason === "string" && row.reason.length > 0 ? { reason: row.reason } : {}),
  }
}

export function evaluateShardFaultReport(report) {
  const control = report.mode === "control"
  const expected = control ? [CONTROL_ID] : SCENARIO_IDS
  const rows = expected.map((id) => verdictFor(id, report.scenarios?.[id]))
  const unexpected = Object.keys(report.scenarios ?? {}).filter((id) => !expected.includes(id))
  const failedGates = Object.entries(report.gates ?? {})
    .filter(([, gate]) => gate?.status !== "pass" || !Array.isArray(gate.evidence) || gate.evidence.length === 0)
    .map(([name]) => name)
  const pass = rows.every((row) => row.verdict === "PASS") && unexpected.length === 0 && failedGates.length === 0
  return {
    exitCode: pass ? 0 : 1,
    verdict: pass ? "PASS" : "FAIL",
    expected: expected.length,
    passed: rows.filter((row) => row.verdict === "PASS").length,
    failed: rows.filter((row) => row.verdict === "FAIL").map((row) => row.id),
    failedGates,
    unexpected,
    rows,
  }
}
