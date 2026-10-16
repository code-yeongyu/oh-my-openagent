import type { IsolationBackendKind } from "@oh-my-opencode/omo-config-core"

export type { IsolationBackendKind } from "@oh-my-opencode/omo-config-core"

export type TaskIsolationSpec = {
  readonly backend: IsolationBackendKind
  readonly fell_back?: boolean
  readonly merged_dir: string
  readonly base_dir: string
  readonly mode: "patch" | "branch"
  readonly apply: boolean
}

export type IsolationMergeKind =
  | "applied" | "already-applied" | "not-applied" | "branch-merged" | "branch-merge-failed" | "no-changes" | "retained"

export type IsolationMergeResult = {
  readonly kind: IsolationMergeKind
  readonly changesApplied: boolean
  readonly duration_ms?: number
  readonly patchPath?: string
  readonly error?: string
  readonly reason?: string
  readonly summaryPath?: string
  readonly filesChanged?: number
  readonly nestedPatchPaths?: readonly string[]
  readonly branchName?: string
  readonly partial?: boolean
  readonly conflict?: string
  readonly manualCommand?: string
}

export type IsolationRecord = TaskIsolationSpec & {
  readonly merge_result?: IsolationMergeResult
}

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

export const RUNNER_KINDS = ["child-process", "host-session"] as const

export type RunnerKind = (typeof RUNNER_KINDS)[number]

export const SUSPENSION_REASONS = [
  "daemon_unavailable",
  "handoff_parked",
  "host_draining",
  "host_incompatible",
  "idle_evicted",
  "own_host_unreachable",
  // The session that owns the child was resumed, but its reconcile could not revive the child yet;
  // `revival_deferred_reason` names the reconcile's deferral (omo#9498).
  "revival_deferred",
  "store_index_unavailable",
] as const

export type SuspensionReason = (typeof SUSPENSION_REASONS)[number]

// Why a task reattached onto a session that cannot continue on its own is waiting (senpi#3266):
// the resumed turn ENDED on an abort, or it never answered at all. `awaiting_input.since` is the
// reattach timestamp; the flag clears on a successful delivery, a plain reattach, or terminal.
export const AWAITING_INPUT_REASONS = [
  "resumed_turn_aborted",
  "resumed_turn_unfinished",
] as const

export type AwaitingInputReason = (typeof AWAITING_INPUT_REASONS)[number]

export type TaskAwaitingInput = {
  readonly reason: AwaitingInputReason
  readonly since: string
}

export type HostSessionIdentity = {
  readonly effect_seq?: number
  readonly socket: string
  readonly routing_id: string
  readonly session_path: string
  readonly instance_id: string
  readonly daemon_pid?: number
}

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
  readonly service_tier?: string
  readonly source: ResolvedModelSource
}

export {
  COST_REPORT_STATUSES,
  DURATION_SOURCE_STATUSES,
  TOKEN_COVERAGE_STATUSES,
} from "./run-stats-types"
export type {
  CostReportStatus,
  DurationSourceStatus,
  TaskRunStats,
  TokenCoverageStatus,
} from "./run-stats-types"
export { isSpawnSpecV1 } from "./record-types"
export type {
  LegacyProcessSpawnSpec,
  PendingSteeringEntry,
  ReviveDeliveryUncertainty,
  SpawnSpecV1,
  StartQueued,
  TaskNotification,
  CancelRequest,
  TaskRecord,
  TaskRecordInput,
  TaskSpawnSpec,
} from "./record-types"
export type {
  TaskTransition,
  TaskTransitionAudit,
  TaskTransitionResult,
} from "./transition-types"
