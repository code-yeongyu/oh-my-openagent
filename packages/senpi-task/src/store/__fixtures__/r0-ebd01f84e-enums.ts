// Frozen from R0 record-parse.ts, record-blocks-parse.ts, run-stats-parse.ts and
// omo-config-core/schema/task.ts at ebd01f84e. Failure/reason sets live beside this file.
const backends = ["auto", "apfs", "btrfs", "zfs", "reflink", "overlayfs", "block-clone", "rcopy"]
const modelSources = ["category", "explicit", "agent"]
export const R0_ENUM_FIELDS: Readonly<Record<string, readonly string[]>> = {
  status: ["pending", "running", "completed", "error", "cancelled", "interrupted", "lost"],
  residency_state: ["resident", "evicted", "disposed", "persisted_only", "rpc_detached"],
  team_role: ["member"],
  background_mode: ["foreground", "background", "promoted"],
  runner_kind: ["child-process", "host-session"],
  "owner.kind": ["dag"],
  "requested_model.source": modelSources,
  "resolved_model.source": modelSources,
  "fallback_models.*.source": modelSources,
  "fallback_attempts.*.source": modelSources,
  "isolation.backend": backends,
  "isolation.mode": ["patch", "branch"],
  "isolation.merge_result.kind": [
    "applied",
    "already-applied",
    "not-applied",
    "branch-merged",
    "branch-merge-failed",
    "no-changes",
    "retained",
  ],
  "spawn_spec.isolation.backend": backends,
  "spawn_spec.isolation.mode": ["patch", "branch"],
  "run_stats.token_status": ["complete", "partial", "unavailable"],
  "run_stats.cost_status": ["reported", "unavailable", "invalid"],
  "run_stats.duration_status": ["monotonic", "wall_clock", "unavailable"],
  "pending_steering.*.deliver_as": ["steer", "followUp"],
}

export function validateR0Enums(record: Record<string, unknown>): readonly string[] {
  const dropped: string[] = []
  for (const [path, allowed] of Object.entries(R0_ENUM_FIELDS)) {
    // R0 treats every non-v1 spawn spec as legacy cwd-only data.
    if (path.startsWith("spawn_spec.") && valuesAt(record, ["spawn_spec", "version"])[0] !== 1) continue
    for (const value of valuesAt(record, path.split("."))) {
      if (value === undefined) continue
      if (typeof value === "string" && allowed.includes(value)) continue
      // Invalid steering entries are dropped, not a reason to hide the entire task.
      if (path === "pending_steering.*.deliver_as") dropped.push(path)
      else throw new Error(`R0 rejects ${path} ${String(value)}`)
    }
  }
  // Unknown additive fields, including the entire fallback_closing_child block, are ignored by R0.
  return dropped
}

function valuesAt(value: unknown, path: readonly string[]): readonly unknown[] {
  const [key, ...rest] = path
  if (key === undefined) return [value]
  if (key === "*") return Array.isArray(value) ? value.flatMap((entry) => valuesAt(entry, rest)) : []
  if (typeof value !== "object" || value === null) return []
  return valuesAt(Reflect.get(value, key), rest)
}
