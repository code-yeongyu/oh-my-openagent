export const TASK_STATUSES = [
  "pending",
  "running",
  "completed",
  "error",
  "cancelled",
  "interrupted",
  "lost",
] as const

export type TaskStatus = (typeof TASK_STATUSES)[number]

export const RESIDENCY_STATES = [
  "resident",
  "evicted",
  "disposed",
  "persisted_only",
  "rpc_detached",
] as const

export type ResidencyState = (typeof RESIDENCY_STATES)[number]
export type Messageability = "steer" | "revive" | "not-continuable"

export type TaskNotification = {
  readonly run_epoch: number
  readonly notified_epoch: number
  readonly notification_failed_epoch?: number
}

export type TaskRecordInput = {
  readonly name?: string
  readonly parent_session_id: string
  readonly root_session_id: string
  readonly depth: number
  readonly agent_type?: string
  readonly category?: string
  readonly execution_mode: string
  readonly model: string
  readonly tool_allow?: readonly string[]
  readonly tool_deny?: readonly string[]
}

export type TaskRecord = TaskRecordInput & {
  readonly task_id: string
  readonly status: TaskStatus
  readonly residency_state: ResidencyState
  readonly created_at: string
  readonly updated_at: string
  readonly pid?: number
  readonly child_session_id?: string
  readonly final_response?: string
  readonly error_message?: string
  readonly notification: TaskNotification
}

export type TaskTransition =
  | {
      readonly type: "start"
      readonly timestamp: string
      readonly pid?: number
      readonly child_session_id?: string
    }
  | {
      readonly type: "complete"
      readonly timestamp: string
      readonly final_response: string
    }
  | {
      readonly type: "fail"
      readonly timestamp: string
      readonly error_message: string
    }
  | {
      readonly type: "cancel"
      readonly timestamp: string
      readonly error_message?: string
    }
  | {
      readonly type: "interrupt"
      readonly timestamp: string
      readonly error_message?: string
    }
  | {
      readonly type: "lose"
      readonly timestamp: string
      readonly error_message: string
    }
  | {
      readonly type: "evict" | "dispose" | "persist_only" | "detach_rpc" | "mark_resident"
      readonly timestamp: string
    }

export type TaskTransitionAudit =
  | {
      readonly type: "transition_applied"
      readonly status: TaskStatus
      readonly residency_state: ResidencyState
    }
  | {
      readonly type: "late_transition_ignored"
      readonly attempted_status: TaskStatus
      readonly current_status: TaskStatus
    }

export type TaskTransitionResult = {
  readonly applied: boolean
  readonly record: TaskRecord
  readonly audit: TaskTransitionAudit
}
