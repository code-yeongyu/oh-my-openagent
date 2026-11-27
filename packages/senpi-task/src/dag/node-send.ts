// Send: delivering a message to one node's child through the task manager's steering engine, and
// folding the outcome of a child that was revived outside any wave.
import type { SendOutcome } from "../steering"
import { dagNodeSteeredEvent, dagNodeTransitionedEvent } from "./events"
import { guidePausedDag } from "./paused-controls"
import type { DagRunRecordV1 } from "./manager"
import { controlJournal, DagNodeControlError, ownedRecord } from "./node-control-context"
import { decideSend, steerRecordRefused, watchRevivedTask } from "./node-send-revive"
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
  // Fast path only: refuses a run another live process holds before the lock; it never allows.
  ownedRecord(options, runId)
  const decision = decideSend(options, runId, nodeId)
  const node = decision.record.nodes.find((entry) => entry.id === nodeId)
  if (decision.kind === "guidance") {
    const guidance = guidePausedDag(options, runId, message, nodeId)
    return {
      nodeId,
      delivery: "guidance",
      guidanceId: guidance.id,
      ...(node?.taskId === undefined ? {} : { taskId: node.taskId }),
    }
  }
  const { record } = decision
  // A revive that wrote the lease and then did not revive (it steered, or was refused) gives it back.
  const giveBack = (): void => {
    if (decision.kind === "revive" && decision.leaseTaken)
      releaseDagRunLease(options.store, runId, options.hostPid ?? process.pid)
  }
  let revived = false
  try {
    // `classifySend` admitted steer and revive only for a node with a child.
    const taskId = node?.taskId
    if (node === undefined || taskId === undefined) throw new Error("send decision admitted a node without a child")
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
    // From a revived child on, the send never gives the lease back: the revive watcher owns its end.
    revived = outcome.kind === "revived"
    const result = foldSendOutcome(options, record, node, taskId, outcome, watchRevived)
    if (!revived) giveBack()
    return result
  } catch (error) {
    if (!revived) giveBack()
    throw error
  }
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
      controlJournal(options, record, undefined, steerRecordRefused(options, nodeId)).append(
        dagNodeSteeredEvent({ nodeId, taskId, delivery: "steer" }),
      )
      return { nodeId, taskId, delivery: "steer" }
    case "revived": {
      // The child runs now: its watcher is armed before any fallible write and owns the lease's end.
      const settled = watchRevived?.(nodeId, taskId) ?? watchRevivedTask(options, nodeId, taskId)
      const journal = controlJournal(options, record)
      journal.append(dagNodeSteeredEvent({ nodeId, taskId, delivery: "revive" }))
      journal.append(dagNodeTransitionedEvent({ nodeId, from: node.state, to: "running", reason: { kind: "revived" } }))
      return { nodeId, taskId, delivery: "revive", settled }
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
