import type { TaskStartFailureTransition } from "./start-failure"
import type { TaskRecord } from "./record-types"
import type { TaskRunStats } from "./run-stats-types"
import type { HostSessionIdentity, ResidencyState, RunnerKind, TaskStatus } from "./types"

export type TaskTransition =
  | {
      readonly type: "start"
      readonly timestamp: string
      readonly pid?: number
      readonly child_session_id?: string
      readonly runner_kind?: RunnerKind
      readonly host_session?: HostSessionIdentity
    }
  | {
      readonly type: "complete"
      readonly timestamp: string
      readonly final_response: string
      readonly run_stats?: TaskRunStats
    }
  | TaskStartFailureTransition<TaskRunStats>
  | {
      readonly type: "cancel"
      readonly timestamp: string
      readonly error_message?: string
      readonly run_stats?: TaskRunStats
      // Cancel only the run a handle minted at this epoch names (fenceRun); never a successor run.
      readonly expected_run_epoch?: number
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
  | {
      readonly type: "epoch_mismatch_ignored"
      readonly expected_run_epoch: number
      readonly run_epoch: number
    }

export type TaskTransitionResult = {
  readonly applied: boolean
  readonly record: TaskRecord
  readonly audit: TaskTransitionAudit
}
