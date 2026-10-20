import type { TaskStartFailureKind } from "../state/start-failure"
import type { DagNodeId, DagRunId, DagNodeState, DagNodeCounts, DagNodeError, DagDiagnostic, DagEventLane } from "./types"

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
  // #8396: journaled once when a scheduled node first parks behind the session's residency cap,
  // naming how many resident children hold it and how many belong to OTHER owners (a sibling
  // run, a team, a task spawn) - the only explanation the /dag view has for a quiet run.
  | { readonly kind: "residency_queued"; readonly residents: number; readonly heldByOtherOwners: number }

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
      readonly automatic?: { readonly attempt: number; readonly failureKind: TaskStartFailureKind; readonly delayMs: number }
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
