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

export const RESOLVED_MODEL_SOURCES = ["category", "explicit", "agent"] as const

export type ResolvedModelSource = (typeof RESOLVED_MODEL_SOURCES)[number]

export type ResolvedModelRecord = {
  readonly provider: string
  readonly model_id: string
  readonly display: string
  /** @deprecated mirrors `reasoning` during the unification deprecation window. */
  readonly variant?: string
  /** @deprecated legacy persisted spelling; read through `reasoning`. */
  readonly reasoning_effort?: string
  /** Canonical unified reasoning level (off|minimal|low|medium|high|xhigh|max) or a harness-native preset token. */
  readonly reasoning?: string
  readonly source: ResolvedModelSource
}

// Usage/runtime facts accumulated over ONE run of the child (spawn to terminal transition).
// total_tokens sums usage.totalTokens across assistant turns (billed volume: context re-sent
// per turn counts every time); output_tokens sums completion tokens only. generation_ms sums
// assistant streaming windows, so tokens_per_second reflects generation speed, not tool time.
export type TaskRunStats = {
  readonly runtime_ms: number
  readonly turns: number
  readonly tool_calls: number
  readonly output_tokens?: number
  readonly total_tokens?: number
  readonly generation_ms?: number
  readonly tokens_per_second?: number
}

export type TaskNotification = {
  readonly run_epoch: number
  readonly notified_epoch: number
  readonly notification_failed_epoch?: number
  readonly liveness_notified_epoch?: number
}

export type TaskSpawnSpec = {
  readonly cwd: string
  readonly extensions?: readonly string[]
  readonly member_env?: Readonly<Record<string, string>>
}

export type TaskRecordInput = {
  readonly name?: string
  // Human label supplied by the task tool's `description` param. Status surfaces lead with this,
  // falling back to name and only then to the opaque task id.
  readonly description?: string
  readonly parent_session_id: string
  readonly root_session_id: string
  readonly depth: number
  readonly agent_type?: string
  readonly category?: string
  readonly execution_mode: string
  readonly model: string
  readonly requested_model?: ResolvedModelRecord
  readonly fallback_models?: readonly ResolvedModelRecord[]
  readonly fallback_attempts?: readonly ResolvedModelRecord[]
  readonly resolved_model?: ResolvedModelRecord
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
  // Pid of the host process that spawned (and owns) this child. Lets a sibling process in the same
  // project distinguish "previous process died" from "a live process still owns this child" during
  // reconciliation, so cross-process session starts never falsely mark live in-process children lost.
  readonly host_pid?: number
  readonly child_session_id?: string
  readonly spawn_spec?: TaskSpawnSpec
  readonly final_response?: string
  readonly error_message?: string
  // Set true when the terminal error was an external kill / exit-by-signal (todo-8 kill contract); a
  // record FACT, not a status - the state vocabulary stays completed/error/cancelled/interrupted/lost.
  readonly killed?: boolean
  readonly run_stats?: TaskRunStats
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
      readonly run_stats?: TaskRunStats
    }
  | {
      readonly type: "fail"
      readonly timestamp: string
      readonly error_message: string
      readonly killed?: boolean
      readonly run_stats?: TaskRunStats
    }
  | {
      readonly type: "cancel"
      readonly timestamp: string
      readonly error_message?: string
      readonly run_stats?: TaskRunStats
    }
  | {
      readonly type: "interrupt"
      readonly timestamp: string
      readonly error_message?: string
      readonly run_stats?: TaskRunStats
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
  | {
      readonly type: "invalid_transition_ignored"
      readonly attempted_status: TaskStatus
      readonly current_status: TaskStatus
    }

export type TaskTransitionResult = {
  readonly applied: boolean
  readonly record: TaskRecord
  readonly audit: TaskTransitionAudit
}
