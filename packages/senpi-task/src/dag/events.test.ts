import { describe, expect, test } from "bun:test"
import {
  dagDefinitionAmendedEvent,
  dagDiagnosticAddedEvent,
  dagEventLane,
  dagNodeRetriedEvent,
  dagNodeReusedEvent,
  dagNodeSteeredEvent,
  dagNodeTaskAttachedEvent,
  dagNodeTransitionedEvent,
  dagRunCancelledEvent,
  dagRunCompletedEvent,
  dagRunCreatedEvent,
  dagRunFailedEvent,
  dagRunPausedEvent,
  dagRunResumedEvent,
  dagRunStartedEvent,
  dagStreamOverflowEvent,
  dagWaveCompletedEvent,
  dagWaveStartedEvent,
} from "./events"
import type { DagRunEventType } from "./events"
import type { DagNodeCounts, DagNodeError, DagNodeId, DagRunId } from "./types"
import { DAG_RUN_EVENT_TYPES } from "./types"

const nodeA = "node-a" as DagNodeId
const nodeB = "node-b" as DagNodeId
const runId = "run-1" as DagRunId

const counts: DagNodeCounts = {
  total: 2,
  pending: 0,
  blocked: 0,
  scheduled: 0,
  running: 0,
  completed: 2,
  failed: 0,
  cancelled: 0,
  skipped: 0,
}

const nodeError: DagNodeError = {
  code: "task_error",
  message: "boom",
  nodeId: nodeA,
  at: "2026-01-01T00:00:00.000Z",
}

describe("dagEventLane", () => {
  describe("#given all 14 journaled event types", () => {
    test("#then every one classifies as boundary without throwing", () => {
      // given / when / then
      expect(DAG_RUN_EVENT_TYPES).toHaveLength(17)
      for (const type of DAG_RUN_EVENT_TYPES) {
        let lane: string | undefined
        expect(() => {
          lane = dagEventLane(type)
        }).not.toThrow()
        expect(lane).toBe("boundary")
      }
    })
  })

  describe("#given an unknown type string", () => {
    test("#when classified #then it throws (exhaustiveness guard)", () => {
      // given
      const bogus = "dag.unknown.event" as DagRunEventType

      // when / then
      expect(() => dagEventLane(bogus)).toThrow()
    })
  })
})

describe("dag event builders", () => {
  test("#given run fields #when dagRunCreatedEvent #then spec-shaped payload", () => {
    // when
    const event = dagRunCreatedEvent({
      runKey: "key-1",
      name: "run",
      definitionFingerprint: "fp",
      nodeCount: 2,
      edgeCount: 1,
    })

    // then
    expect(event).toEqual({
      type: "dag.run.created",
      runKey: "key-1",
      name: "run",
      definitionFingerprint: "fp",
      nodeCount: 2,
      edgeCount: 1,
    })
  })

  test("#given a generation #when dagRunStartedEvent #then spec-shaped payload", () => {
    // when
    const event = dagRunStartedEvent({ generation: 3 })

    // then
    expect(event).toEqual({ type: "dag.run.started", generation: 3 })
  })

  test("#given a reason #when dagRunPausedEvent #then spec-shaped payload", () => {
    // when
    const event = dagRunPausedEvent({ reason: "session_shutdown" })

    // then
    expect(event).toEqual({ type: "dag.run.paused", reason: "session_shutdown" })
  })

  test("#given no reason #when dagRunPausedEvent #then reason omitted", () => {
    // when
    const event = dagRunPausedEvent()

    // then
    expect(event).toEqual({ type: "dag.run.paused" })
  })

  test("#given a generation #when dagRunResumedEvent #then spec-shaped payload", () => {
    // when
    const event = dagRunResumedEvent({ generation: 2 })

    // then
    expect(event).toEqual({ type: "dag.run.resumed", generation: 2 })
  })

  test("#given counts #when dagRunCompletedEvent #then spec-shaped payload", () => {
    // when
    const event = dagRunCompletedEvent({ counts })

    // then
    expect(event).toEqual({ type: "dag.run.completed", counts })
  })

  test("#given an error and counts #when dagRunFailedEvent #then spec-shaped payload", () => {
    // when
    const event = dagRunFailedEvent({ error: nodeError, counts })

    // then
    expect(event).toEqual({ type: "dag.run.failed", error: nodeError, counts })
  })

  test("#given a reason and counts #when dagRunCancelledEvent #then spec-shaped payload", () => {
    // when
    const event = dagRunCancelledEvent({ reason: "user", counts })

    // then
    expect(event).toEqual({ type: "dag.run.cancelled", reason: "user", counts })
  })

  test("#given a wave #when dagWaveStartedEvent #then spec-shaped payload", () => {
    // when
    const event = dagWaveStartedEvent({ waveIndex: 1, nodeIds: [nodeA, nodeB] })

    // then
    expect(event).toEqual({ type: "dag.wave.started", waveIndex: 1, nodeIds: [nodeA, nodeB] })
  })

  test("#given a wave #when dagWaveCompletedEvent #then spec-shaped payload", () => {
    // when
    const event = dagWaveCompletedEvent({ waveIndex: 0, nodeIds: [nodeA] })

    // then
    expect(event).toEqual({ type: "dag.wave.completed", waveIndex: 0, nodeIds: [nodeA] })
  })

  test("#given a transition #when dagNodeTransitionedEvent #then spec-shaped payload", () => {
    // when
    const event = dagNodeTransitionedEvent({
      nodeId: nodeA,
      from: "blocked",
      to: "scheduled",
      reason: { kind: "unblocked" },
    })

    // then
    expect(event).toEqual({
      type: "dag.node.transitioned",
      nodeId: nodeA,
      from: "blocked",
      to: "scheduled",
      reason: { kind: "unblocked" },
    })
  })

  test("#given a task attach #when dagNodeTaskAttachedEvent #then spec-shaped payload", () => {
    // when
    const event = dagNodeTaskAttachedEvent({ nodeId: nodeA, taskId: "task-1", attempt: 1 })

    // then
    expect(event).toEqual({
      type: "dag.node.task-attached",
      nodeId: nodeA,
      taskId: "task-1",
      attempt: 1,
    })
  })

  test("#given a reuse source #when dagNodeReusedEvent #then spec-shaped payload", () => {
    // when
    const event = dagNodeReusedEvent({ nodeId: nodeB, taskId: "task-9", sourceRunId: runId })

    // then
    expect(event).toEqual({
      type: "dag.node.reused",
      nodeId: nodeB,
      taskId: "task-9",
      sourceRunId: runId,
    })
  })

  test("#given a retry #when dagNodeRetriedEvent #then spec-shaped payload", () => {
    // when
    const event = dagNodeRetriedEvent({
      nodeId: nodeA,
      priorTaskId: "task-prior",
      execAttempt: 2,
      promptChanged: true,
    })

    // then
    expect(event).toEqual({
      type: "dag.node.retried",
      nodeId: nodeA,
      priorTaskId: "task-prior",
      execAttempt: 2,
      promptChanged: true,
    })
  })

  test("#given a retry without prior task #when dagNodeRetriedEvent #then priorTaskId omitted", () => {
    // when
    const event = dagNodeRetriedEvent({ nodeId: nodeA, execAttempt: 1, promptChanged: false })

    // then
    expect(event).toEqual({
      type: "dag.node.retried",
      nodeId: nodeA,
      execAttempt: 1,
      promptChanged: false,
    })
  })

  test("#given a steer delivery #when dagNodeSteeredEvent #then spec-shaped payload", () => {
    // when
    const event = dagNodeSteeredEvent({ nodeId: nodeA, taskId: "task-1", delivery: "steer" })

    // then
    expect(event).toEqual({
      type: "dag.node.steered",
      nodeId: nodeA,
      taskId: "task-1",
      delivery: "steer",
    })
  })

  test("#given a revive delivery #when dagNodeSteeredEvent #then spec-shaped payload", () => {
    // when
    const event = dagNodeSteeredEvent({ nodeId: nodeB, taskId: "task-2", delivery: "revive" })

    // then
    expect(event).toEqual({
      type: "dag.node.steered",
      nodeId: nodeB,
      taskId: "task-2",
      delivery: "revive",
    })
  })

  test("#given an amendment #when dagDefinitionAmendedEvent #then spec-shaped payload", () => {
    // when
    const event = dagDefinitionAmendedEvent({
      previousFingerprint: "fp-old",
      fingerprint: "fp-new",
      changedNodeIds: [nodeA],
      addedNodeIds: [nodeB],
      invalidatedNodeIds: [nodeA, nodeB],
    })

    // then
    expect(event).toEqual({
      type: "dag.definition.amended",
      previousFingerprint: "fp-old",
      fingerprint: "fp-new",
      changedNodeIds: [nodeA],
      addedNodeIds: [nodeB],
      invalidatedNodeIds: [nodeA, nodeB],
    })
  })

  test("#given a diagnostic #when dagDiagnosticAddedEvent #then spec-shaped payload", () => {
    // given
    const diagnostic = {
      kind: "run_flag" as const,
      message: "heads up",
      at: "2026-01-01T00:00:00.000Z",
    }

    // when
    const event = dagDiagnosticAddedEvent({ diagnostic })

    // then
    expect(event).toEqual({ type: "dag.diagnostic.added", diagnostic })
  })

  test("#given an overflow #when dagStreamOverflowEvent #then spec-shaped payload", () => {
    // when
    const event = dagStreamOverflowEvent({ droppedCount: 5, recoverAfterSeq: 42 })

    // then
    expect(event).toEqual({ type: "dag.stream.overflow", droppedCount: 5, recoverAfterSeq: 42 })
  })

  test("#given any builder output #when inspected #then no envelope seq or at is assigned here", () => {
    // when
    const events = [
      dagRunCreatedEvent({
        runKey: "k",
        name: "n",
        definitionFingerprint: "fp",
        nodeCount: 1,
        edgeCount: 0,
      }),
      dagRunStartedEvent({ generation: 1 }),
      dagRunPausedEvent(),
      dagRunResumedEvent({ generation: 1 }),
      dagRunCompletedEvent({ counts }),
      dagRunFailedEvent({ error: nodeError, counts }),
      dagRunCancelledEvent({ counts }),
      dagWaveStartedEvent({ waveIndex: 0, nodeIds: [nodeA] }),
      dagWaveCompletedEvent({ waveIndex: 0, nodeIds: [nodeA] }),
      dagNodeTransitionedEvent({
        nodeId: nodeA,
        from: "pending",
        to: "blocked",
        reason: { kind: "unblocked" },
      }),
      dagNodeTaskAttachedEvent({ nodeId: nodeA, taskId: "t", attempt: 1 }),
      dagNodeReusedEvent({ nodeId: nodeA, taskId: "t", sourceRunId: runId }),
      dagNodeRetriedEvent({ nodeId: nodeA, execAttempt: 1, promptChanged: false }),
      dagNodeSteeredEvent({ nodeId: nodeA, taskId: "t", delivery: "steer" }),
      dagDefinitionAmendedEvent({
        previousFingerprint: "fp-old",
        fingerprint: "fp-new",
        changedNodeIds: [nodeA],
        addedNodeIds: [],
        invalidatedNodeIds: [nodeA],
      }),
      dagDiagnosticAddedEvent({
        diagnostic: { kind: "run_flag", message: "m", at: "2026-01-01T00:00:00.000Z" },
      }),
      dagStreamOverflowEvent({ droppedCount: 1, recoverAfterSeq: 0 }),
    ]

    // then: seq/at/lane are the WAL writer's job, never the builders'
    for (const event of events) {
      expect(event).not.toHaveProperty("seq")
      expect(event).not.toHaveProperty("at")
      expect(event).not.toHaveProperty("lane")
      expect(event).not.toHaveProperty("runId")
    }
  })
})
