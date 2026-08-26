// allow: SIZE_OK - single public type contract for the dag subsystem; splitting it would fragment one cohesive domain vocabulary across imports.
import type { TaskRunStats } from "../state/types"
import type { TaskTargetErrorCode } from "../tools/task/validation"

export type DagRunId = string & { readonly __brand: "DagRunId" }
export type DagNodeId = string & { readonly __brand: "DagNodeId" }

export const DAG_RUN_STATUSES = [
  "pending",
  "running",
  "paused",
  "completed",
  "failed",
  "cancelled",
] as const

export type DagRunStatus = (typeof DAG_RUN_STATUSES)[number]

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
}

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

export const DAG_NODE_TRANSITION_REASONS = [
  { kind: "unblocked" },
  { kind: "scheduled" },
  { kind: "started" },
  { kind: "succeeded" },
  { kind: "failed" },
  { kind: "cancelled" },
  { kind: "skipped" },
  { kind: "interrupted" },
  { kind: "lost" },
  { kind: "resumed" },
  { kind: "retried" },
  { kind: "amend_invalidated" },
  { kind: "revived" },
] as const

export type DagNodeTransitionReason =
  | (typeof DAG_NODE_TRANSITION_REASONS)[number]
  | { readonly kind: "task_queued"; readonly queuePosition: number }

// The journaled payload union. EXACTLY 17 members; every member is written to the WAL with a
// WAL-assigned seq. Live activity telemetry is NOT here - see DagActivityEvent below.
export const DAG_RUN_EVENT_TYPES = [
  "dag.run.created",
  "dag.run.started",
  "dag.run.paused",
  "dag.run.resumed",
  "dag.run.completed",
  "dag.run.failed",
  "dag.run.cancelled",
  "dag.wave.started",
  "dag.wave.completed",
  "dag.node.transitioned",
  "dag.node.task-attached",
  "dag.node.reused",
  "dag.node.retried",
  "dag.node.steered",
  "dag.definition.amended",
  "dag.diagnostic.added",
  "dag.stream.overflow",
] as const

export type DagRunEventPayload =
  | {
      readonly type: "dag.run.created"
      readonly runKey: string
      readonly name: string
      readonly definitionFingerprint: string
      readonly nodeCount: number
      readonly edgeCount: number
    }
  | { readonly type: "dag.run.started"; readonly generation: number }
  | { readonly type: "dag.run.paused"; readonly reason?: string }
  | { readonly type: "dag.run.resumed"; readonly generation: number }
  | { readonly type: "dag.run.completed"; readonly counts: DagNodeCounts }
  | {
      readonly type: "dag.run.failed"
      readonly error: DagNodeError
      readonly counts: DagNodeCounts
    }
  | { readonly type: "dag.run.cancelled"; readonly reason?: string; readonly counts: DagNodeCounts }
  | {
      readonly type: "dag.wave.started"
      readonly waveIndex: number
      readonly nodeIds: readonly DagNodeId[]
    }
  | {
      readonly type: "dag.wave.completed"
      readonly waveIndex: number
      readonly nodeIds: readonly DagNodeId[]
    }
  | {
      readonly type: "dag.node.transitioned"
      readonly nodeId: DagNodeId
      readonly from: DagNodeState
      readonly to: DagNodeState
      readonly reason: DagNodeTransitionReason
    }
  | {
      readonly type: "dag.node.task-attached"
      readonly nodeId: DagNodeId
      readonly taskId: string
      readonly attempt: number
    }
  | {
      readonly type: "dag.node.reused"
      readonly nodeId: DagNodeId
      readonly taskId: string
      readonly sourceRunId: DagRunId
    }
  | {
      readonly type: "dag.node.retried"
      readonly nodeId: DagNodeId
      readonly priorTaskId?: string
      readonly execAttempt: number
      readonly promptChanged: boolean
    }
  | {
      readonly type: "dag.node.steered"
      readonly nodeId: DagNodeId
      readonly taskId: string
      readonly delivery: "steer" | "revive"
    }
  | {
      readonly type: "dag.definition.amended"
      readonly previousFingerprint: string
      readonly fingerprint: string
      readonly changedNodeIds: readonly DagNodeId[]
      readonly addedNodeIds: readonly DagNodeId[]
      readonly invalidatedNodeIds: readonly DagNodeId[]
    }
  | { readonly type: "dag.diagnostic.added"; readonly diagnostic: DagDiagnostic }
  | {
      readonly type: "dag.stream.overflow"
      readonly droppedCount: number
      readonly recoverAfterSeq: number
    }

export type DagRunEventEnvelope = {
  readonly schemaVersion: 1
  readonly runId: DagRunId
  readonly seq: number
  readonly at: string
  readonly lane: DagEventLane
}

// The wire event is the FLAT intersection of envelope and payload: type, seq, and the payload
// fields are siblings on one object (viewer catch-up dedupes on event.seq + event.type).
export type DagRunEvent = DagRunEventEnvelope & DagRunEventPayload

// Live activity telemetry: UNSEQUENCED, never journaled, emitted on its own channel. It must
// never be added to DagRunEventPayload - an unsequenced event inside the sequenced WAL union
// corrupts replay.
export const DAG_ACTIVITY_CHANNEL = "omo.dag.activity"

export type DagActivityEvent = {
  readonly schemaVersion: 1
  readonly runId: DagRunId
  readonly nodeId: DagNodeId
  readonly taskId: string
  readonly at: string
  readonly activity: string
  readonly currentTool?: string
  readonly lastAssistantLine?: string
  readonly turns: number
  readonly toolCalls?: number
}
