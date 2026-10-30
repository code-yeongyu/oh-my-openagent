import type { TaskRecord } from "../state"

export type ReviveDriftPolicy = "recorded_warn" | "recorded_silent" | "refuse"
// Owner OQ5 is pending. This internal policy constant is the one-line owner switch, not config.
export const ACTIVE_REVIVE_DRIFT_POLICY: ReviveDriftPolicy = "recorded_warn"
export type ReviveGenerationWarning = {
  readonly code: "config_generation_mismatch"
  readonly task_id: string
  readonly parent_session_id: string
  readonly recorded_generation: number
  readonly current_generation: number
}
export type RevivePolicyPort = {
  readonly currentGeneration: () => number | undefined
  readonly warn: (warning: ReviveGenerationWarning) => void
  readonly policy?: ReviveDriftPolicy
}

export function checkReviveGeneration(record: TaskRecord, port: RevivePolicyPort | undefined): boolean {
  const current = port?.currentGeneration()
  const recorded = record.config_generation
  if (port === undefined || recorded === undefined || current === undefined || current === recorded) return true
  const policy = port.policy ?? ACTIVE_REVIVE_DRIFT_POLICY
  switch (policy) {
    case "recorded_warn":
      port.warn({ code: "config_generation_mismatch", task_id: record.task_id, parent_session_id: record.parent_session_id, recorded_generation: recorded, current_generation: current })
      return true
    case "recorded_silent": return true
    case "refuse": return false
    default: return assertNever(policy)
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected revive drift policy: ${JSON.stringify(value)}`)
}

export function isColdRevivalCandidate(record: TaskRecord): boolean {
  if (record.killed === true) return false
  // A daemon-hosted child is PARKED, not finished: the daemon evicted its session, or the daemon
  // itself went away mid-turn. Reopening it from its transcript and delivering the message is the
  // whole point of retaining it, so `running` belongs in the revivable set here - unlike a
  // child-process child, whose `running` record means a live OS process nobody may talk over.
  if (record.runner_kind === "host-session" && record.residency_state === "rpc_detached") {
    return record.status !== "pending" && record.status !== "cancelled" && record.status !== "lost"
  }
  return ((record.execution_mode === "in-process" && record.residency_state === "persisted_only") ||
    (record.execution_mode === "process" && record.residency_state === "rpc_detached")) &&
    (record.status === "completed" || record.status === "error" || record.status === "interrupted")
}
