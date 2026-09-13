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
    reason: "Message delivery could not be confirmed durably; inspect task_output before continuing.",
    suggestion: "Do not resend automatically; inspect task_output and explicitly resolve the recorded delivery first.",
  }
}

export function uncertainDeliveryDenial(record: TaskRecord, message: string): SendOutcome | undefined {
  const uncertain = record.revive_delivery_uncertain
  if (uncertain === undefined) return undefined
  // Retained batches cannot be retried implicitly, even by a distinct message. An ordinary
  // running turn without a retained batch still accepts distinct steering as before.
  if (record.status !== "running" || (record.pending_steering?.length ?? 0) > 0 ||
    (uncertain.run_epoch === record.notification.run_epoch && uncertain.message_sha256 === messageSha256(message))) {
    return deliveryUncertain(record, uncertain.run_epoch)
  }
  return undefined
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
  // Finished-run output and timing reset; unresolved delivery is durable evidence, not run
  // bookkeeping. Only explicit resolution or acknowledgment may remove its marker.
  const {
    final_response: _final,
    error_message: _error,
    run_stats: _stats,
    terminal_at: _terminalAt,
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
