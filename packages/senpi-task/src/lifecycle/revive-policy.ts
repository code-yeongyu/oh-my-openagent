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
  return ((record.execution_mode === "in-process" && record.residency_state === "persisted_only") ||
    (record.execution_mode === "process" && record.residency_state === "rpc_detached")) &&
    (record.status === "completed" || record.status === "error" || record.status === "interrupted") && record.killed !== true
}
