import { createHash } from "node:crypto"

import { interactionPolicyForAgent } from "../agents"
import type { TaskRecord } from "../state"
import type { SendInput, SendOutcome } from "./types"

export function oneShotPolicyDenial(record: TaskRecord): SendOutcome | undefined {
  const agentType = record.agent_type
  if (agentType === undefined) return undefined
  const policy = interactionPolicyForAgent(agentType)
  if (policy?.oneShot !== true) return undefined
  return { kind: "one_shot_agent", task_id: record.task_id, agent: agentType, message: policy.sendDenialReminder }
}

export function scopeDenied(record: TaskRecord, input: SendInput): SendOutcome | undefined {
  if (input.callerSessionId === undefined || input.allScope === true) return undefined
  const caller = input.callerSessionId
  if (caller === record.parent_session_id || caller === record.root_session_id) return undefined
  return {
    kind: "scope_denied",
    task_id: record.task_id,
    owning_session_id: record.parent_session_id,
    reason: `Task ${record.task_id} belongs to session ${record.parent_session_id}; pass all_scope to send across sessions.`,
  }
}

export function notContinuableReason(record: TaskRecord): string {
  // Persisted-only and non-terminal RPC children resume only with their session. Terminal RPC
  // children with a transcript are the sole suspended records eligible for lazy task_send revival.
  if (record.residency_state === "persisted_only" || record.residency_state === "rpc_detached") {
    return `Task ${record.task_id} is suspended - resumes when its session is resumed.`
  }
  if (record.residency_state === "disposed") return `Task ${record.task_id} was disposed and can no longer be continued.`
  if (record.residency_state === "evicted") return `Task ${record.task_id} was evicted from residency and can no longer be continued.`
  return `Task ${record.task_id} is ${record.status} and can no longer be continued.`
}

export function messageSha256(message: string): string {
  return createHash("sha256").update(message, "utf8").digest("hex")
}

export function deliveryUncertain(record: TaskRecord, runEpoch: number): SendOutcome {
  return {
    kind: "delivery_uncertain",
    task_id: record.task_id,
    run_epoch: runEpoch,
    reason: "child exited before acknowledging the message; inspect task_output before resending",
    suggestion: "Do not resend automatically; inspect task_output first.",
  }
}

export function lazyRevivalFailure(record: TaskRecord, reason: string): SendOutcome {
  return {
    kind: "not_continuable",
    task_id: record.task_id,
    reason: `Task ${record.task_id} could not be revived: ${reason}`,
    suggestion: "Use task_output to read the final result.",
  }
}

export function buildRevived(record: TaskRecord, timestamp: string): TaskRecord {
  // run_stats, terminal_at, and any unacknowledged-delivery marker describe the FINISHED run; none
  // may cross into the new run (a stale marker would otherwise ride every later epoch).
  const {
    final_response: _final,
    error_message: _error,
    run_stats: _stats,
    terminal_at: _terminalAt,
    revive_delivery_uncertain: _uncertain,
    ...rest
  } = record
  return {
    ...rest,
    status: "running",
    residency_state: "resident",
    updated_at: timestamp,
    notification: { ...record.notification, run_epoch: record.notification.run_epoch + 1 },
  }
}
