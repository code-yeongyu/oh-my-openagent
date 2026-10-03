import type { DagTaskOwner } from "../dag/owner"
import type { TaskStartFailureRecordFields } from "./start-failure"
import type {
  BackgroundMode,
  HostSessionIdentity,
  IsolationRecord,
  ResolvedModelRecord,
  ResidencyState,
  RunnerKind,
  SuspensionReason,
  TaskIsolationSpec,
  TaskStatus,
} from "./types"
import type { TaskRunStats } from "./run-stats-types"

export type TaskNotification = {
  readonly run_epoch: number
  readonly notified_epoch: number
  readonly notification_failed_epoch?: number
  readonly liveness_notified_epoch?: number
}

export type StartQueued = {
  readonly model: string
  readonly queued_at: string
  readonly queue_position: number
}

export type ReviveDeliveryUncertainty = {
  readonly run_epoch: number
  readonly message_sha256: string
}

export type LegacyProcessSpawnSpec = {
  readonly cwd: string
  readonly extensions?: readonly string[]
  readonly member_env?: Readonly<Record<string, string>>
}

export type SpawnSpecV1 = {
  readonly isolation?: TaskIsolationSpec
  readonly version: 1
  readonly cwd: string
  readonly prompt: string
  readonly instructions?: string
  readonly member_scoped_tool_names?: readonly string[]
}

export type TaskSpawnSpec = LegacyProcessSpawnSpec | SpawnSpecV1

export function isSpawnSpecV1(spec: TaskSpawnSpec): spec is SpawnSpecV1 {
  return "version" in spec && spec.version === 1
}

export type PendingSteeringEntry = {
  readonly id: string
  readonly message: string
  readonly deliver_as: "steer" | "followUp"
  readonly workpool?: {
    readonly pool_id: string
    readonly item_id: string
    readonly key: string
    readonly generation: number
    readonly run_epoch: number
  }
}

export type TaskRecordInput = {
  readonly name?: string
  readonly task_summary?: string
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
  readonly notify_on_terminal: boolean
  readonly pending_steering?: readonly PendingSteeringEntry[]
  readonly owner?: DagTaskOwner
  readonly team_run_id?: string
  readonly team_name?: string
  readonly team_member_name?: string
  readonly team_role?: "member"
  readonly task_seq?: number
  readonly config_generation?: number
  readonly background_mode?: BackgroundMode
  readonly runner_kind?: RunnerKind
  readonly host_session?: HostSessionIdentity
}

export type TaskRecord = TaskRecordInput & TaskStartFailureRecordFields & {
  readonly isolation?: IsolationRecord
  readonly task_id: string
  readonly status: TaskStatus
  readonly residency_state: ResidencyState
  readonly created_at: string
  readonly updated_at: string
  readonly started_at?: string
  readonly terminal_at?: string
  readonly pid?: number
  readonly host_pid?: number
  readonly child_session_id?: string
  readonly spawn_spec?: TaskSpawnSpec
  readonly final_response?: string
  readonly error_message?: string
  readonly killed?: boolean
  readonly run_stats?: TaskRunStats
  readonly notification: TaskNotification
  readonly revive_delivery_uncertain?: ReviveDeliveryUncertainty
  readonly resumed_run_epoch?: number
  readonly start_queued?: StartQueued
  readonly suspension_reason?: SuspensionReason
  readonly runner_kind?: RunnerKind
  readonly host_session?: HostSessionIdentity
  readonly fallback_handoff_epoch?: number
  readonly fallback_closing_child?: { readonly pid?: number; readonly host_session?: HostSessionIdentity }
  readonly residency_claim?: string
  // task_cancel accepted while the child was unreachable (omo#9403). The cancel is final: every
  // revival reads it and finishes the cancel instead of running the child again.
  readonly cancel_requested?: CancelRequest
}

export type CancelRequest = {
  readonly requested_at: string
  readonly reason?: string
}
