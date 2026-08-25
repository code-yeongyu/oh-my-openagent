import type {
  DagDiagnostic,
  DagEventLane,
  DagNodeCounts,
  DagNodeError,
  DagNodeId,
  DagNodeState,
  DagNodeTransitionReason,
  DagRunEventPayload,
  DagRunId,
} from "./types"

export type DagRunEventType = DagRunEventPayload["type"]

// Every journaled type is a boundary event; the "activity" lane exists only for the
// separate unsequenced DagActivityEvent transport, so no journaled type maps to it.
export function dagEventLane(type: DagRunEventType): DagEventLane {
  switch (type) {
    case "dag.run.created":
    case "dag.run.started":
    case "dag.run.paused":
    case "dag.run.resumed":
    case "dag.run.completed":
    case "dag.run.failed":
    case "dag.run.cancelled":
    case "dag.wave.started":
    case "dag.wave.completed":
    case "dag.node.transitioned":
    case "dag.node.task-attached":
    case "dag.node.reused":
    case "dag.node.retried":
    case "dag.node.steered":
    case "dag.definition.amended":
    case "dag.diagnostic.added":
    case "dag.stream.overflow":
      return "boundary"
    default: {
      const exhaustive: never = type
      throw new Error(`unknown dag run event type: ${String(exhaustive)}`)
    }
  }
}

export function dagRunCreatedEvent(input: {
  runKey: string
  name: string
  definitionFingerprint: string
  nodeCount: number
  edgeCount: number
}): DagRunEventPayload {
  return {
    type: "dag.run.created",
    runKey: input.runKey,
    name: input.name,
    definitionFingerprint: input.definitionFingerprint,
    nodeCount: input.nodeCount,
    edgeCount: input.edgeCount,
  }
}

export function dagRunStartedEvent(input: { generation: number }): DagRunEventPayload {
  return { type: "dag.run.started", generation: input.generation }
}

export function dagRunPausedEvent(input: { reason?: string } = {}): DagRunEventPayload {
  return input.reason === undefined
    ? { type: "dag.run.paused" }
    : { type: "dag.run.paused", reason: input.reason }
}

export function dagRunResumedEvent(input: { generation: number }): DagRunEventPayload {
  return { type: "dag.run.resumed", generation: input.generation }
}

export function dagRunCompletedEvent(input: { counts: DagNodeCounts }): DagRunEventPayload {
  return { type: "dag.run.completed", counts: input.counts }
}

export function dagRunFailedEvent(input: {
  error: DagNodeError
  counts: DagNodeCounts
}): DagRunEventPayload {
  return { type: "dag.run.failed", error: input.error, counts: input.counts }
}

export function dagRunCancelledEvent(input: {
  reason?: string
  counts: DagNodeCounts
}): DagRunEventPayload {
  return input.reason === undefined
    ? { type: "dag.run.cancelled", counts: input.counts }
    : { type: "dag.run.cancelled", reason: input.reason, counts: input.counts }
}

export function dagWaveStartedEvent(input: {
  waveIndex: number
  nodeIds: readonly DagNodeId[]
}): DagRunEventPayload {
  return { type: "dag.wave.started", waveIndex: input.waveIndex, nodeIds: input.nodeIds }
}

export function dagWaveCompletedEvent(input: {
  waveIndex: number
  nodeIds: readonly DagNodeId[]
}): DagRunEventPayload {
  return { type: "dag.wave.completed", waveIndex: input.waveIndex, nodeIds: input.nodeIds }
}

export function dagNodeTransitionedEvent(input: {
  nodeId: DagNodeId
  from: DagNodeState
  to: DagNodeState
  reason: DagNodeTransitionReason
}): DagRunEventPayload {
  return {
    type: "dag.node.transitioned",
    nodeId: input.nodeId,
    from: input.from,
    to: input.to,
    reason: input.reason,
  }
}

export function dagNodeTaskAttachedEvent(input: {
  nodeId: DagNodeId
  taskId: string
  attempt: number
}): DagRunEventPayload {
  return {
    type: "dag.node.task-attached",
    nodeId: input.nodeId,
    taskId: input.taskId,
    attempt: input.attempt,
  }
}

export function dagNodeReusedEvent(input: {
  nodeId: DagNodeId
  taskId: string
  sourceRunId: DagRunId
}): DagRunEventPayload {
  return {
    type: "dag.node.reused",
    nodeId: input.nodeId,
    taskId: input.taskId,
    sourceRunId: input.sourceRunId,
  }
}

export function dagNodeRetriedEvent(input: {
  nodeId: DagNodeId
  priorTaskId?: string
  execAttempt: number
  promptChanged: boolean
}): DagRunEventPayload {
  const payload: DagRunEventPayload = {
    type: "dag.node.retried",
    nodeId: input.nodeId,
    execAttempt: input.execAttempt,
    promptChanged: input.promptChanged,
  }
  if (input.priorTaskId !== undefined) {
    return { ...payload, priorTaskId: input.priorTaskId }
  }
  return payload
}

export function dagNodeSteeredEvent(input: {
  nodeId: DagNodeId
  taskId: string
  delivery: "steer" | "revive"
}): DagRunEventPayload {
  return {
    type: "dag.node.steered",
    nodeId: input.nodeId,
    taskId: input.taskId,
    delivery: input.delivery,
  }
}

export function dagDefinitionAmendedEvent(input: {
  previousFingerprint: string
  fingerprint: string
  changedNodeIds: readonly DagNodeId[]
  addedNodeIds: readonly DagNodeId[]
  invalidatedNodeIds: readonly DagNodeId[]
}): DagRunEventPayload {
  return {
    type: "dag.definition.amended",
    previousFingerprint: input.previousFingerprint,
    fingerprint: input.fingerprint,
    changedNodeIds: input.changedNodeIds,
    addedNodeIds: input.addedNodeIds,
    invalidatedNodeIds: input.invalidatedNodeIds,
  }
}

export function dagDiagnosticAddedEvent(input: {
  diagnostic: DagDiagnostic
}): DagRunEventPayload {
  return { type: "dag.diagnostic.added", diagnostic: input.diagnostic }
}

export function dagStreamOverflowEvent(input: {
  droppedCount: number
  recoverAfterSeq: number
}): DagRunEventPayload {
  return {
    type: "dag.stream.overflow",
    droppedCount: input.droppedCount,
    recoverAfterSeq: input.recoverAfterSeq,
  }
}
