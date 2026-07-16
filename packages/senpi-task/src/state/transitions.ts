import type {
  ResidencyState,
  TaskRecord,
  TaskStatus,
  TaskTransition,
  TaskTransitionResult,
} from "./types"

const terminalStatuses = new Set<TaskStatus>(["completed", "error", "cancelled", "interrupted", "lost"])
const residencyTransitionTypes = new Set<TaskTransition["type"]>([
  "evict",
  "dispose",
  "persist_only",
  "detach_rpc",
  "mark_resident",
])

function transitionStatus(transition: TaskTransition, current: TaskStatus): TaskStatus {
  switch (transition.type) {
    case "start":
      return "running"
    case "complete":
      return "completed"
    case "fail":
      return "error"
    case "cancel":
      return "cancelled"
    case "interrupt":
      return "interrupted"
    case "lose":
      return "lost"
    case "evict":
    case "dispose":
    case "persist_only":
    case "detach_rpc":
    case "mark_resident":
      return current
    default:
      return assertNever(transition)
  }
}

function transitionResidency(transition: TaskTransition, current: ResidencyState): ResidencyState {
  switch (transition.type) {
    case "evict":
      return "evicted"
    case "dispose":
      return "disposed"
    case "persist_only":
      return "persisted_only"
    case "detach_rpc":
      return "rpc_detached"
    case "mark_resident":
      return "resident"
    case "start":
    case "complete":
    case "fail":
    case "cancel":
    case "interrupt":
    case "lose":
      return current
    default:
      return assertNever(transition)
  }
}

function applyTransitionFields(record: TaskRecord, transition: TaskTransition): TaskRecord {
  switch (transition.type) {
    case "start":
      return {
        ...record,
        ...(transition.pid === undefined ? {} : { pid: transition.pid }),
        ...(transition.child_session_id === undefined ? {} : { child_session_id: transition.child_session_id }),
      }
    case "complete":
      return { ...record, final_response: transition.final_response }
    case "fail":
      return { ...record, error_message: transition.error_message, ...(transition.killed === true ? { killed: true } : {}) }
    case "lose":
      return { ...record, error_message: transition.error_message }
    case "cancel":
    case "interrupt":
      return transition.error_message === undefined ? record : { ...record, error_message: transition.error_message }
    case "evict":
    case "dispose":
    case "persist_only":
    case "detach_rpc":
    case "mark_resident":
      return record
    default:
      return assertNever(transition)
  }
}

export function transitionTaskRecord(record: TaskRecord, transition: TaskTransition): TaskTransitionResult {
  const nextStatus = transitionStatus(transition, record.status)
  const changesOnlyResidency = residencyTransitionTypes.has(transition.type)
  if (terminalStatuses.has(record.status) && !changesOnlyResidency) {
    return {
      applied: false,
      record,
      audit: {
        type: "late_transition_ignored",
        attempted_status: nextStatus,
        current_status: record.status,
      },
    }
  }

  if (!isStatusTransitionAllowed(record.status, transition)) {
    return {
      applied: false,
      record,
      audit: {
        type: "invalid_transition_ignored",
        attempted_status: nextStatus,
        current_status: record.status,
      },
    }
  }

  const nextResidency = transitionResidency(transition, record.residency_state)
  const withFields = applyTransitionFields(record, transition)
  const nextRecord = {
    ...withFields,
    status: nextStatus,
    residency_state: nextResidency,
    updated_at: transition.timestamp,
  }

  return {
    applied: true,
    record: nextRecord,
    audit: {
      type: "transition_applied",
      status: nextRecord.status,
      residency_state: nextRecord.residency_state,
    },
  }
}

export function markRecordLostForReconciliation(
  record: TaskRecord,
  input: { readonly timestamp: string; readonly error_message: string },
): TaskTransitionResult {
  if (terminalStatuses.has(record.status)) {
    return {
      applied: false,
      record,
      audit: {
        type: "late_transition_ignored",
        attempted_status: "lost",
        current_status: record.status,
      },
    }
  }

  const nextRecord = {
    ...record,
    status: "lost" as const,
    error_message: input.error_message,
    updated_at: input.timestamp,
  }

  return {
    applied: true,
    record: nextRecord,
    audit: {
      type: "transition_applied",
      status: nextRecord.status,
      residency_state: nextRecord.residency_state,
    },
  }
}

function isStatusTransitionAllowed(current: TaskStatus, transition: TaskTransition): boolean {
  switch (transition.type) {
    case "start":
      return current === "pending"
    case "cancel":
      return current === "running" || current === "pending"
    case "complete":
    case "fail":
    case "interrupt":
      return current === "running"
    case "lose":
      return false
    case "evict":
    case "dispose":
    case "persist_only":
    case "detach_rpc":
    case "mark_resident":
      return true
    default:
      return assertNever(transition)
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected task transition: ${JSON.stringify(value)}`)
}
