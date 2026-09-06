// Send: delivering a message to one node's child through the task manager's steering engine, and
// folding the outcome of a child that was revived outside any wave.
import type { TaskRecord, TaskStatus } from "../state"
import type { SendOutcome } from "../steering"
import { dagNodeSteeredEvent, dagNodeTransitionedEvent } from "./events"
import type { DagRunRecordV1 } from "./manager"
import {
  controlErrorMessage,
  controlJournal,
  currentRecord,
  DagNodeControlError,
  ownedRecord,
} from "./node-control-context"
import { persistDagNodeResult } from "./results"
import type { DagSchedulerOptions } from "./scheduler"
import type { DagNode, DagNodeError, DagNodeErrorCode, DagNodeId, DagRunId } from "./types"

export type DagNodeSendResult = {
  readonly nodeId: DagNodeId
  readonly taskId: string
  readonly delivery: "steer" | "revive" | "queued"
  readonly queuePosition?: number
  /** Present only for a revive: resolves once the revived child's new outcome has been folded. */
  readonly settled?: Promise<void>
}

/**
 * Delivers a message to a node's child: a running child is steered in place, a finished resident
 * child is revived on its own session, a queued child takes the message durably, and every
 * non-continuable outcome becomes a typed refusal naming retry as the remedy.
 */
export async function sendToDagNode(
  options: DagSchedulerOptions,
  runId: DagRunId,
  nodeId: DagNodeId,
  message: string,
  watchRevived?: (nodeId: DagNodeId, taskId: string) => Promise<void> | undefined,
): Promise<DagNodeSendResult> {
  const record = ownedRecord(options, runId)
  const node = record.nodes.find((entry) => entry.id === nodeId)
  if (node === undefined) {
    throw new DagNodeControlError({ code: "node_not_found", message: `unknown dag node "${nodeId}"`, runId, nodeIds: [nodeId] })
  }
  // #7412 defect 2: a completed or cancelled run is settled evidence. Reviving a child here
  // would journal running nodes under a terminal run - a checkpoint no recovery path can ever
  // claim again (resume claims only "paused" runs). Failed runs stay sendable: revive is the
  // documented remedy for a failed node whose child is still resident.
  if (record.status === "completed" || record.status === "cancelled") {
    throw new DagNodeControlError({
      code: "node_not_continuable",
      message: record.status === "completed"
        ? `dag run "${runId}" already completed; node "${nodeId}" cannot be steered or revived. Amend the definition or start a new run.`
        : `dag run "${runId}" was cancelled; node "${nodeId}" cannot be steered or revived. Retry the node to run it again.`,
      runId,
      nodeIds: [nodeId],
    })
  }
  const taskId = node.taskId
  if (taskId === undefined) {
    throw new DagNodeControlError({
      code: "node_has_no_task",
      message: `dag node "${nodeId}" never started a child; retry the run to dispatch it`,
      runId,
      nodeIds: [nodeId],
    })
  }
  if (options.taskManager.get(taskId) === undefined) {
    throw new DagNodeControlError({
      code: "node_not_found",
      message: `dag node "${nodeId}" points at task ${taskId}, which no longer exists`,
      runId,
      nodeIds: [nodeId],
    })
  }
  const outcome = await options.taskManager.sendToTask({
    idOrName: taskId,
    message,
    callerSessionId: record.parentSessionId,
    allScope: true,
  })
  return foldSendOutcome(options, record, node, taskId, outcome, watchRevived)
}

function foldSendOutcome(
  options: DagSchedulerOptions,
  record: DagRunRecordV1,
  node: DagNode,
  taskId: string,
  outcome: SendOutcome,
  watchRevived?: (nodeId: DagNodeId, taskId: string) => Promise<void> | undefined,
): DagNodeSendResult {
  const runId = record.runId
  const nodeId = node.id
  switch (outcome.kind) {
    case "queued":
      // The steering engine persisted the message on the child's record; the node itself did not
      // change state, and dag.node.steered has no vocabulary for an undelivered message.
      return { nodeId, taskId, delivery: "queued", queuePosition: outcome.queue_position }
    case "steered":
      controlJournal(options, record).append(dagNodeSteeredEvent({ nodeId, taskId, delivery: "steer" }))
      return { nodeId, taskId, delivery: "steer" }
    case "revived": {
      const journal = controlJournal(options, record)
      journal.append(dagNodeSteeredEvent({ nodeId, taskId, delivery: "revive" }))
      journal.append(dagNodeTransitionedEvent({ nodeId, from: node.state, to: "running", reason: { kind: "revived" } }))
      return {
        nodeId,
        taskId,
        delivery: "revive",
        settled: watchRevived?.(nodeId, taskId) ?? watchRevivedTask(options, nodeId, taskId),
      }
    }
    case "delivery_uncertain":
      throw new DagNodeControlError({
        code: "node_not_continuable",
        message: `dag node "${nodeId}" has uncertain delivery for task ${taskId}: ${outcome.reason} ${outcome.suggestion}`,
        runId,
        nodeIds: [nodeId],
      })
    case "capacity_deferred":
      throw new DagNodeControlError({
        code: "node_not_continuable",
        message: `dag node "${nodeId}" could not revive: ${outcome.reason}`,
        runId,
        nodeIds: [nodeId],
      })
    case "one_shot_agent":
      throw new DagNodeControlError({
        code: "node_not_continuable",
        message: `dag node "${nodeId}" runs one-shot agent ${outcome.agent}: ${outcome.message} Retry the node instead.`,
        runId,
        nodeIds: [nodeId],
      })
    case "scope_denied":
      throw new DagNodeControlError({
        code: "node_not_continuable",
        message: `dag node "${nodeId}" cannot be messaged: ${outcome.reason} Retry the node instead.`,
        runId,
        nodeIds: [nodeId],
      })
    case "not_continuable":
      throw new DagNodeControlError({
        code: "node_not_continuable",
        message: `dag node "${nodeId}" cannot be continued: ${outcome.reason} Retry the node to run it again.`,
        runId,
        nodeIds: [nodeId],
      })
    case "not_found":
      throw new DagNodeControlError({
        code: "node_not_found",
        message: `dag node "${nodeId}" points at task ${taskId}, which no longer exists`,
        runId,
        nodeIds: [nodeId],
      })
  }
}

// A revived child can settle OUTSIDE the live settle loop (the run may already be quiescent):
// no admission pass is necessarily awaiting this task, so the send arms the one watcher that folds
// its new terminal outcome and persists its result exactly once.
async function watchRevivedTask(
  options: DagSchedulerOptions,
  nodeId: DagNodeId,
  taskId: string,
): Promise<void> {
  const now = options.now ?? Date.now
  const runId = options.initialRecord.runId
  let task: TaskRecord
  try {
    task = await options.taskManager.waitFor(taskId)
  } catch (error) {
    failRevivedNode(options, nodeId, "task_error", controlErrorMessage(error), now)
    return
  }
  if (task.status === "pending" || task.status === "running") {
    failRevivedNode(options, nodeId, "task_error", `revived task ${taskId} settled nonterminal`, now)
    return
  }
  if (task.status !== "completed") {
    const failure = revivedTaskFailure(task.status, task.error_message)
    failRevivedNode(options, nodeId, failure.code, failure.message, now)
    return
  }
  // Persist before the transition: the reducer rebuilds artifact metadata and run stats from the
  // durable copy, so a crash between the two still replays into an identical checkpoint.
  const persisted = persistDagNodeResult({ store: options.store, runId, nodeId, record: task, now })
  if (persisted.kind === "failed") throw new Error(persisted.diagnostic.message)
  const journal = controlJournal(options, currentRecord(options, runId))
  journal.append(dagNodeTransitionedEvent({ nodeId, from: "running", to: "completed", reason: { kind: "succeeded" } }))
}

function failRevivedNode(
  options: DagSchedulerOptions,
  nodeId: DagNodeId,
  code: DagNodeErrorCode,
  message: string,
  now: () => number,
): void {
  const runId = options.initialRecord.runId
  const pendingErrors = new Map<DagNodeId, DagNodeError>([
    [nodeId, { code, message, nodeId, at: new Date(now()).toISOString() }],
  ])
  const journal = controlJournal(options, currentRecord(options, runId), pendingErrors)
  journal.append(dagNodeTransitionedEvent({ nodeId, from: "running", to: "failed", reason: { kind: "failed" } }))
}

function revivedTaskFailure(
  status: Exclude<TaskStatus, "completed" | "pending" | "running">,
  message?: string,
): { readonly code: DagNodeErrorCode; readonly message: string } {
  switch (status) {
    case "error": return { code: "task_error", message: message ?? "task failed" }
    case "interrupted": return { code: "task_interrupted", message: message ?? "task was interrupted" }
    case "lost": return { code: "task_lost", message: message ?? "task was lost" }
    case "cancelled": return { code: "task_cancelled", message: message ?? "task was cancelled" }
  }
}
