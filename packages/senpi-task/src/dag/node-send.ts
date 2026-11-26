// Send: delivering a message to one node's child through the task manager's steering engine, and
// folding the outcome of a child that was revived outside any wave.
import type { SendOutcome } from "../steering"
import { dagNodeSteeredEvent, dagNodeTransitionedEvent } from "./events"
import { guidePausedDag } from "./paused-controls"
import type { DagRunRecordV1 } from "./manager"
import { controlJournal, DagNodeControlError, ownedRecord } from "./node-control-context"
import { decideSend, watchRevivedTask } from "./node-send-revive"
import { releaseDagRunLease } from "./run-lease"
import type { DagSchedulerOptions } from "./scheduler"
import type { DagNode, DagNodeId, DagRunId } from "./types"

export type DagNodeSendResult = {
  readonly nodeId: DagNodeId
  readonly taskId?: string
  readonly delivery: "steer" | "revive" | "queued" | "uncertain" | "guidance" | "held"
  readonly guidanceId?: string
  readonly effectId?: string
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
  const observed = ownedRecord(options, runId)
  const node = observed.nodes.find((entry) => entry.id === nodeId)
  if (node === undefined) {
    throw new DagNodeControlError({
      code: "node_not_found",
      message: `unknown dag node "${nodeId}"`,
      runId,
      nodeIds: [nodeId],
    })
  }
  if (observed.status === "paused" && observed.pause?.reason === "user_stop") {
    const guidance = guidePausedDag(options, runId, message, nodeId)
    return {
      nodeId,
      delivery: "guidance",
      guidanceId: guidance.id,
      ...(node.taskId === undefined ? {} : { taskId: node.taskId }),
    }
  }
  // The read above only routes the user-stopped case and refuses early; every rule below is decided
  // again on the record the send decided from under the run lock (#15125).
  sendableTask(observed, runId, nodeId)
  const { record, leaseTaken } = decideSend(options, runId, nodeId)
  // A send that took the lease and then did not revive (it steered, or was refused) gives it back.
  const giveBack = (): void => {
    if (leaseTaken) releaseDagRunLease(options.store, runId, options.hostPid ?? process.pid)
  }
  try {
    const { node: current, taskId } = sendableTask(record, runId, nodeId)
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
    const result = foldSendOutcome(options, record, current, taskId, outcome, watchRevived)
    if (result.delivery !== "revive") giveBack()
    return result
  } catch (error) {
    giveBack()
    throw error
  }
}

// #7412 defect 2: a completed or cancelled run is settled evidence. Reviving a child here would
// journal running nodes under a terminal run - a checkpoint no recovery path can ever claim again
// (resume claims only "paused" runs). Failed runs stay sendable: revive is the documented remedy for
// a failed node whose child is still resident.
function sendableTask(
  record: DagRunRecordV1,
  runId: DagRunId,
  nodeId: DagNodeId,
): { readonly node: DagNode; readonly taskId: string } {
  if (record.status === "completed" || record.status === "cancelled") {
    throw new DagNodeControlError({
      code: "node_not_continuable",
      message:
        record.status === "completed"
          ? `dag run "${runId}" already completed; node "${nodeId}" cannot be steered or revived. Amend the definition or start a new run.`
          : `dag run "${runId}" was cancelled; node "${nodeId}" cannot be steered or revived. Retry the node to run it again.`,
      runId,
      nodeIds: [nodeId],
    })
  }
  const node = record.nodes.find((entry) => entry.id === nodeId)
  if (node === undefined)
    throw new DagNodeControlError({
      code: "node_not_found",
      message: `unknown dag node "${nodeId}"`,
      runId,
      nodeIds: [nodeId],
    })
  if (node.taskId === undefined) {
    throw new DagNodeControlError({
      code: "node_has_no_task",
      message: `dag node "${nodeId}" never started a child; retry the run to dispatch it`,
      runId,
      nodeIds: [nodeId],
    })
  }
  return { node, taskId: node.taskId }
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
    case "unresponsive":
      throw new DagNodeControlError({ code: "node_unresponsive", message: outcome.reason, runId, nodeIds: [nodeId] })
    case "uncertain":
      return { nodeId, taskId, delivery: "uncertain", effectId: outcome.effect_id }
    case "failed":
      throw new DagNodeControlError({
        code: "node_not_continuable",
        message: `${outcome.reason}: ${outcome.detail}. Action: ${outcome.action}.`,
        runId,
        nodeIds: [nodeId],
      })
    case "queued":
      // The steering engine persisted the message on the child's record; the node itself did not
      // change state, and dag.node.steered has no vocabulary for an undelivered message.
      return { nodeId, taskId, delivery: "queued", queuePosition: outcome.queue_position }
    case "held":
      // The node's run is stopped: the child holds the message and the run's Resume delivers it.
      return { nodeId, taskId, delivery: "held" }
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
    case "admission_refused":
    case "cwd_unavailable":
    case "config_generation_mismatch":
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
    case "stale":
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
