import { randomUUID } from "node:crypto"
import { addGuidance, changeGuidance, type Guidance } from "../pause/guidance"
import type { DagRunRecordV1 } from "./manager"
import { controlJournal, DagNodeControlError, ownedRecord } from "./node-control-context"
import type { DagSchedulerOptions } from "./scheduler"
import type { DagNodeId, DagRunEventPayload, DagRunId } from "./types"

export { pausedAmendmentUnsafe } from "./amend-safety"

export type PausedDagGuideCommand =
  | { readonly kind: "add"; readonly text: string; readonly nodeId?: DagNodeId }
  | { readonly kind: "edit"; readonly id: string; readonly text: string }
  | { readonly kind: "remove"; readonly id: string }

export function applyPausedDagGuidance(
  options: DagSchedulerOptions,
  runId: DagRunId,
  command: PausedDagGuideCommand,
): Guidance {
  switch (command.kind) {
    case "add":
      return guidePausedDag(options, runId, command.text, command.nodeId)
    case "edit":
    case "remove": {
      const record = ownedRecord(options, runId)
      requireUserPaused(record)
      const changed = changeGuidance(record.guidance ?? [], {
        id: command.id,
        editedAt: new Date((options.now ?? Date.now)()).toISOString(),
        ...(command.kind === "edit" ? { text: command.text } : { remove: true }),
      })
      const guidance = changed.find((entry) => entry.id === command.id)
      if (guidance === undefined) throw new Error("guidance change did not retain its record")
      appendWhileStopped(options, record, {
        type: command.kind === "remove" ? "dag.guidance.removed" : "dag.guidance.edited",
        guidance,
      })
      return guidance
    }
    default:
      throw new Error(`Unexpected guidance command: ${command satisfies never}`)
  }
}

/**
 * Writes for a user-stopped-run control only while the run is still stopped by the same Stop,
 * re-decided on the fresh record under the journal's run lock (#15125); otherwise nothing is written
 * and the control is refused. The journal's own duplicate-transition skip stays silent.
 */
function appendWhileStopped(options: DagSchedulerOptions, record: DagRunRecordV1, payload: DagRunEventPayload): void {
  const pauseSeq = record.pause?.pauseSeq
  let resumed = false
  const journal = controlJournal(options, record, undefined, (fresh) => {
    resumed = fresh.status !== "paused" || fresh.pause?.reason !== "user_stop" || fresh.pause.pauseSeq !== pauseSeq
    return resumed
  })
  journal.append(payload)
  if (resumed) {
    throw new DagNodeControlError({
      code: "run_not_user_paused",
      message: "the run is no longer stopped by the user",
      runId: record.runId,
    })
  }
}

export function requireUserPaused(record: DagRunRecordV1): void {
  if (record.status !== "paused" || record.pause?.reason !== "user_stop") {
    throw new DagNodeControlError({
      code: "run_not_user_paused",
      message: "this action requires a user-paused run",
      runId: record.runId,
    })
  }
}

export function guidePausedDag(
  options: DagSchedulerOptions,
  runId: DagRunId,
  text: string,
  nodeId?: DagNodeId,
): Guidance {
  const record = ownedRecord(options, runId)
  requireUserPaused(record)
  if (nodeId !== undefined && !record.nodes.some((node) => node.id === nodeId)) {
    throw new DagNodeControlError({
      code: "node_not_found",
      message: `unknown dag node "${nodeId}"`,
      runId,
      nodeIds: [nodeId],
    })
  }
  const input = {
    id: randomUUID(),
    scope: nodeId === undefined ? { kind: "run" as const } : { kind: "node" as const, nodeId },
    text,
    createdAt: new Date((options.now ?? Date.now)()).toISOString(),
  }
  const guidance = addGuidance(record.guidance ?? [], input).find((entry) => entry.id === input.id)
  if (guidance === undefined) throw new Error("guidance was not created")
  appendWhileStopped(options, record, { type: "dag.guidance.added", guidance })
  return guidance
}

export async function cancelPausedDagNode(
  options: DagSchedulerOptions,
  runId: DagRunId,
  nodeId: DagNodeId,
  ports: { closeHold(taskId: string, cause: "node_cancelled"): Promise<void> },
): Promise<void> {
  const record = ownedRecord(options, runId)
  requireUserPaused(record)
  const node = record.nodes.find((entry) => entry.id === nodeId)
  if (node === undefined)
    throw new DagNodeControlError({
      code: "node_not_found",
      message: `unknown dag node "${nodeId}"`,
      runId,
      nodeIds: [nodeId],
    })
  if (node.state === "completed" || node.state === "cancelled") return
  appendWhileStopped(options, record, { type: "dag.node.cancel_requested", nodeId })
  if (node.taskId !== undefined) {
    const task = options.taskManager.get(node.taskId)
    const result = await options.taskManager.cancelTask(
      node.taskId,
      "node_cancelled",
      task === undefined ? undefined : { expectedRunEpoch: task.notification.run_epoch },
    )
    if (
      result.kind !== "cancelled" &&
      result.kind !== "released" &&
      result.kind !== "noop" &&
      result.kind !== "not_found"
    ) {
      throw new DagNodeControlError({
        code: "node_not_continuable",
        message: "child cancellation was refused",
        runId,
        nodeIds: [nodeId],
      })
    }
    await ports.closeHold(node.taskId, "node_cancelled")
  }
  const fresh = ownedRecord(options, runId)
  requireUserPaused(fresh)
  const current = fresh.nodes.find((entry) => entry.id === nodeId)
  if (fresh.pause?.pauseSeq !== record.pause?.pauseSeq || current === undefined) {
    throw new DagNodeControlError({
      code: "run_paused_by_user",
      message: "the pause changed during cancellation",
      runId,
    })
  }
  appendWhileStopped(options, fresh, {
    type: "dag.node.transitioned",
    nodeId,
    from: current.state,
    to: "cancelled",
    reason: { kind: "cancelled" },
  })
}
