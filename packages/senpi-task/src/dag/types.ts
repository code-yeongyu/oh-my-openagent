import type { TaskRunStats } from "../state/types"
import type { TaskTargetErrorCode } from "../tools/task/validation"

export type DagRunId = string & { readonly __brand: "DagRunId" }
export type DagNodeId = string & { readonly __brand: "DagNodeId" }

// A run id or node id is used verbatim as ONE path segment under the DAG state directory
// (<stateDir>/dag/results/<runId>/<nodeId>.txt), so it must not be empty, a traversal segment
// ("." / ".."), or contain a separator, a NUL byte, or ":" (an NTFS alternate-data-stream
// separator on Windows). This is the single owner of that contract: the graph compiler rejects an
// unsafe node id at the boundary, and the store refuses one at the sink so no caller can
// reintroduce the write/read primitive by bypassing the checked accessors. The store also adds a
// containment check after the join, so the rule does not rest on this deny-list alone.
export function isSafeDagPathSegment(value: string): boolean {
  return value.length > 0
    && value !== "."
    && value !== ".."
    && !value.includes("/")
    && !value.includes("\\")
    && !value.includes("\0")
    && !value.includes(":")
}

export const DAG_RUN_STATUSES = [
  "pending",
  "running",
  "paused",
  "completed",
  "failed",
  "cancelled",
] as const

export type DagRunStatus = (typeof DAG_RUN_STATUSES)[number]

// A run in one of these statuses holds no scheduler or lease and does not count against the session's
// active-run cap; it waits for retention. `send` may still revive a child of a failed run.
export const TERMINAL_DAG_RUN_STATUSES: ReadonlySet<string> = new Set<DagRunStatus>(["completed", "failed", "cancelled"])

/** True for a persisted status string naming a terminal run; unknown or missing statuses are not terminal. */
export function isTerminalDagRunStatus(status: string | undefined): boolean {
  return status !== undefined && TERMINAL_DAG_RUN_STATUSES.has(status)
}

export const DAG_NODE_STATES = [
  "pending",
  "blocked",
  "scheduled",
  "running",
  "completed",
  "failed",
  "cancelled",
  "skipped",
] as const

export type DagNodeState = (typeof DAG_NODE_STATES)[number]

// boundary: state transitions and run lifecycle, journaled with a WAL seq. activity: live
// telemetry lane name used by stream classification; DagActivityEvent itself is unsequenced.
export const DAG_EVENT_LANES = ["activity", "boundary"] as const

export type DagEventLane = (typeof DAG_EVENT_LANES)[number]

// Route contract: category XOR agent. There is NO {kind:"model"} route - a pure-model route is
// forbidden; model may only ride alongside an agent route as an explicit override.
export const DAG_ROUTE_KINDS = ["category", "agent"] as const

export type DagRoute =
  | { readonly kind: "category"; readonly category: string }
  | { readonly kind: "agent"; readonly agent: string; readonly model?: string }

// Node-level user input mirrors the task tool field names exactly: category XOR subagent_type,
// model only alongside subagent_type. The error vocabulary reuses the task tool codes
// (both_targets / category_with_model / no_target) from tools/task/validation.ts.
export type DagNodeTargetInput =
  | {
      readonly prompt: string
      readonly category: string
      readonly subagent_type?: undefined
      readonly model?: undefined
    }
  | {
      readonly prompt: string
      readonly subagent_type: string
      readonly category?: undefined
      readonly model?: string
    }

export type DagNodeTargetErrorCode = TaskTargetErrorCode

export type DagNodeTargetError = {
  readonly code: DagNodeTargetErrorCode
  readonly message: string
}

// Optional task.dag settings block.
export type DagSettings = {
  readonly max_nodes_per_run: number
  readonly max_runs_per_session: number
  readonly subscriber_ring: number
  readonly heartbeat_ms: number
  readonly history_default_limit: number
  readonly history_max_limit: number
  readonly retention_days: number
  readonly max_prompt_bytes: number
}

export const DAG_SETTINGS_DEFAULTS: DagSettings = {
  max_nodes_per_run: 64,
  max_runs_per_session: 16,
  subscriber_ring: 1000,
  heartbeat_ms: 15000,
  history_default_limit: 256,
  history_max_limit: 1000,
  retention_days: 7,
  max_prompt_bytes: 262144,
}

export const DAG_NODE_ERROR_CODES = [
  "plan_unresolved",
  "depth_denied",
  "start_failed",
  "residency_denied",
  "task_error",
  "task_interrupted",
  "task_lost",
  "task_cancelled",
  "resume_task_missing",
  "resume_task_orphaned",
  "journal_corrupt",
] as const

export type DagNodeErrorCode = (typeof DAG_NODE_ERROR_CODES)[number]

export type DagNodeError = {
  readonly code: DagNodeErrorCode
  readonly message: string
  readonly nodeId?: DagNodeId
  readonly at: string
}

export type DagDiagnostic =
  | {
      readonly kind: "route_fallback"
      readonly nodeId: DagNodeId
      readonly message: string
      readonly at: string
    }
  | {
      readonly kind: "node_flag"
      readonly nodeId: DagNodeId
      readonly message: string
      readonly at: string
    }
  | {
      readonly kind: "missing_skill"
      readonly nodeId: DagNodeId
      readonly skill: string
      readonly message: string
      readonly at: string
    }
  | { readonly kind: "run_flag"; readonly message: string; readonly at: string }
  | {
      readonly kind: "journal_corrupt"
      readonly runId?: DagRunId
      readonly path: string
      readonly message: string
      readonly at: string
    }

export type DagNode = {
  readonly id: DagNodeId
  readonly label?: string
  readonly prompt: string
  readonly route: DagRoute
  readonly dependsOn: readonly DagNodeId[]
  readonly state: DagNodeState
  readonly taskId?: string
  readonly attempt: number
  readonly execAttempt?: number
  readonly error?: DagNodeError
  readonly runStats?: TaskRunStats
  readonly createdAt: string
  readonly startedAt?: string
  readonly completedAt?: string
  // Terminal node's final child text, bounded to DAG_NODE_OUTPUT_PREVIEW_CHARS. `outputBytes` is
  // always the FULL persisted size, so a shorter `output` means the preview was truncated and a
  // completed node reading `outputBytes: 0` is durable evidence the child returned nothing. Without
  // this the only surface carrying node output was the blocking wait, which the detached midpoint
  // peek never reaches (#8674).
  readonly output?: string
  readonly outputBytes?: number
  // When the backing child last wrote a transcript event. Present only while the node is running,
  // because it describes a LIVE child: a node running with no recent activity is either
  // finished-but-unreaped or genuinely stalled, and `running` alone cannot tell those apart (#8674).
  readonly lastActivityAt?: string
}

// Per-node output budget in the checkpoint. A node's final message is normally far shorter; the cap
// only stops one pathological child from dominating every checkpoint rewrite for the whole run.
export const DAG_NODE_OUTPUT_PREVIEW_CHARS = 2000

// How long a running node's child may write nothing before a status surface calls the silence out.
// It is a reporting threshold, never an execution one: nothing is cancelled or failed by it.
export const DAG_NODE_QUIET_AFTER_MS = 600_000

export type DagEdge = {
  readonly from: DagNodeId
  readonly to: DagNodeId
}

export type DagWave = {
  readonly index: number
  readonly nodeIds: readonly DagNodeId[]
}

export type DagBottleneck = {
  readonly nodeId: DagNodeId
  readonly blockedCount: number
}

export type DagNodeCounts = {
  readonly total: number
  readonly pending: number
  readonly blocked: number
  readonly scheduled: number
  readonly running: number
  readonly completed: number
  readonly failed: number
  readonly cancelled: number
  readonly skipped: number
}

export type DagRunSnapshot = {
  readonly schemaVersion: 1
  readonly runId: DagRunId
  readonly runKey: string
  readonly name: string
  readonly parentSessionId: string
  readonly rootSessionId: string
  readonly status: DagRunStatus
  readonly generation: number
  readonly createdAt: string
  readonly startedAt?: string
  readonly completedAt?: string
  readonly definitionFingerprint: string
  readonly lastSeq: number
  readonly nodes: readonly DagNode[]
  readonly edges: readonly DagEdge[]
  readonly waves: readonly DagWave[]
  readonly criticalPath: readonly DagNodeId[]
  readonly bottlenecks: readonly DagBottleneck[]
  readonly diagnostics: readonly DagDiagnostic[]
  readonly counts: DagNodeCounts
  // One entry per accepted amendment. Observe surfaces read this projection, so it must carry the
  // history rather than making them reach for the raw record. Absent on never-amended runs.
  readonly amendHistory?: readonly AmendRecord[]
  // Host pid holding the resume lease on a paused run. Display surfaces need it to tell a run that
  // is being resumed right now from one that is genuinely parked. Absent unless a claim is held.
  readonly leaseHolderPid?: number
}

// One entry per accepted amendment. Defined here rather than in manager.ts so the snapshot, the wire
// payload, and the /dag renderer share one shape instead of three independent `unknown[]` widenings;
// it depends only on DagNodeId, which lives in this module, so no import cycle is introduced.
export type AmendRecord = {
  readonly at: string
  readonly previousFingerprint: string
  readonly fingerprint: string
  readonly changedNodeIds: readonly DagNodeId[]
  readonly addedNodeIds: readonly DagNodeId[]
  readonly invalidatedNodeIds: readonly DagNodeId[]
}

export { DAG_NODE_TRANSITION_REASONS, DAG_RUN_EVENT_TYPES, DAG_ACTIVITY_CHANNEL } from "./event-types"
export type { DagNodeTransitionReason, DagRunEventPayload, DagRunEventEnvelope, DagRunEvent, DagActivityEvent } from "./event-types"
