import type { DagTaskOwner } from "../dag/owner"

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

export const BACKGROUND_MODES = ["foreground", "background", "promoted"] as const

export type BackgroundMode = (typeof BACKGROUND_MODES)[number]

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

export const TOKEN_COVERAGE_STATUSES = ["complete", "partial", "unavailable"] as const

export type TokenCoverageStatus = (typeof TOKEN_COVERAGE_STATUSES)[number]

export const COST_REPORT_STATUSES = ["reported", "unavailable", "invalid"] as const

export type CostReportStatus = (typeof COST_REPORT_STATUSES)[number]

export const DURATION_SOURCE_STATUSES = ["monotonic", "wall_clock", "unavailable"] as const

export type DurationSourceStatus = (typeof DURATION_SOURCE_STATUSES)[number]

// Usage/runtime facts accumulated over ONE run of the child (spawn to terminal transition).
// total_tokens sums usage.totalTokens across assistant turns (billed volume: context re-sent
// per turn counts every time); output_tokens sums completion tokens only. generation_ms sums
// assistant streaming windows. tokens_per_second is emitted ONLY when every token-bearing
// generation window has a non-zero measured duration; when any token-bearing window collapsed
// to zero (post-hoc RPC burst, clock coalescing), the lost timing makes generation throughput
// unverifiable and the field is omitted rather than reporting a runtime-derived substitute.
export type TaskRunStats = {
  readonly runtime_ms: number
  readonly turns: number
  readonly tool_calls: number
  readonly output_tokens?: number
  /** Summed prompt tokens the provider billed as fresh (cache reads/writes are counted separately). */
  readonly input_tokens?: number
  /** Summed tokens served from the provider's prompt cache over the run. */
  readonly cache_read_tokens?: number
  /** Summed tokens the provider wrote into its prompt cache over the run. */
  readonly cache_write_tokens?: number
  readonly total_tokens?: number
  readonly generation_ms?: number
  readonly tokens_per_second?: number
  /** Summed provider-reported spend for the run, in USD. */
  readonly cost_usd?: number
  /** cacheRead / (input + cacheRead + cacheWrite) for the latest assistant request with a nonzero
   * denominator, as a 0..1 fraction. Running status surfaces use this to match Senpi's footer. */
  readonly cache_hit_rate_last?: number
  /** Sum(cacheRead) / Sum(input + cacheRead + cacheWrite) over the whole run, as a 0..1 fraction.
   * Completed-run summaries use this aggregate. Omitted when no turn reported a denominator. */
  readonly cache_hit_rate_run?: number
  /** Usage coverage of the token totals: every assistant turn reported usage, only some did, or none. */
  readonly token_status?: TokenCoverageStatus
  /** Whether `cost_usd` is a provider-reported figure; a missing cost is never a zero cost. */
  readonly cost_status?: CostReportStatus
  /** Provenance of `runtime_ms`: measured by the live tracker, or reconstructed from record timestamps. */
  readonly duration_status?: DurationSourceStatus
}

export type TaskNotification = {
  readonly run_epoch: number
  readonly notified_epoch: number
  readonly notification_failed_epoch?: number
  readonly liveness_notified_epoch?: number
}

// The shape persisted today: process-mode children respawn over RPC from cwd alone, with
// extensions/member_env carried as untrusted launch inputs (the store parser discards them).
// RPC respawn may keep consuming this shape; in-process rebuild must NOT (see SpawnSpecV1).
export type LegacyProcessSpawnSpec = {
  readonly cwd: string
  readonly extensions?: readonly string[]
  readonly member_env?: Readonly<Record<string, string>>
}

// Mode-neutral rebuild spec. Carries ONLY plain-data launch facts - never executable
// ToolDefinitions, auth, registries, extensions, or member_env; those are rebuilt from the
// resumed process's live registries. In-process rebuild REQUIRES this shape and otherwise
// fails spawn_spec_unavailable.
export type SpawnSpecV1 = {
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

// One durable prelaunch steering message. deliver_as mirrors the live steering vocabulary:
// "steer" nudges the active turn, "followUp" starts a fresh one.
export type PendingSteeringEntry = {
  readonly id: string
  readonly message: string
  readonly deliver_as: "steer" | "followUp"
}

export type TaskRecordInput = {
  readonly name?: string
  // One-line delegated-work summary from the task tool's `task_summary` param. Status surfaces
  // lead with this, then description, then name, and only then the opaque task id.
  readonly task_summary?: string
  // Human label supplied by the task tool's `description` param.
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
  // Durable intent to notify the parent when this child reaches a terminal state. Persisted so a
  // resumed process can still fire (or skip) the notification for children it did not spawn.
  readonly notify_on_terminal: boolean
  // Durable prelaunch steering queue, drained in order once the child starts. Omitted when empty.
  readonly pending_steering?: readonly PendingSteeringEntry[]
  readonly owner?: DagTaskOwner
  // Session-local spawn ordinal, assigned once per parent session at spawn. A relational key for
  // grouping a logical task's runs; absent on records persisted before ordinals shipped.
  readonly task_seq?: number
  // Generation of the effective category/model configuration that planned this task. Absent when
  // the planner did not stamp one (legacy records, non-category spawns).
  readonly config_generation?: number
  // How the task ran relative to the parent turn: spawned in the foreground, spawned in the
  // background, or promoted to background mid-run. `notify_on_terminal` alone cannot tell the
  // last two apart. Absent on records persisted before the mode shipped.
  readonly background_mode?: BackgroundMode
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
