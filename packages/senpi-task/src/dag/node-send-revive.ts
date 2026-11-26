// The take-over half of send (#15125): which record a send decides from, the run it acquires before
// reviving a child of a settled run, the release when no revive happened, and the watcher that folds
// a revived child's outcome (the write whose reducer gives the lease up).
import { defaultSignaller } from "../lifecycle/context"
import type { TaskRecord, TaskStatus } from "../state"
import { dagNodeTransitionedEvent } from "./events"
import type { DagRunRecordV1 } from "./manager"
import {
  controlErrorMessage,
  controlJournal,
  currentRecord,
  DagNodeControlError,
  runBusy,
} from "./node-control-context"
import { persistDagNodeResult } from "./results"
import { acquireDagRun, classifySend, dagRunEligibility, decideDagRun, type DagSendClass } from "./run-acquisition"
import { reserveWhenFree } from "./run-reservations"
import type { DagSchedulerOptions } from "./scheduler"
import { type DagNodeError, type DagNodeErrorCode, type DagNodeId, type DagRunId } from "./types"

export type DagSendDecision =
  | { readonly kind: "guidance"; readonly record: DagRunRecordV1 }
  | { readonly kind: "steer"; readonly record: DagRunRecordV1 }
  | { readonly kind: "revive"; readonly record: DagRunRecordV1; readonly leaseTaken: boolean }

/**
 * Decides a send ONCE, on one fresh record under one run lock (#15125): the acquisition checks the
 * send's classification (`classifySend`), the holder rule and the verb's reservation, and writes this
 * host's lease only for a revive (`leaseWhen`). Only `steer` and `revive` may reach the child;
 * `guidance` routes to the stopped-run write; everything else throws its typed refusal.
 */
export function decideSend(options: DagSchedulerOptions, runId: DagRunId, nodeId: DagNodeId): DagSendDecision {
  const parentSessionId = options.initialRecord.parentSessionId
  const acquired = acquireDagRun<DagRunRecordV1>(options.store, runId, {
    operation: "send",
    probe: {
      taskManager: options.taskManager,
      hostPid: options.hostPid ?? process.pid,
      isProcessAlive: options.isProcessAlive ?? defaultSignaller.isAlive,
    },
    ...(options.reservation === undefined ? {} : { reservation: options.reservation }),
    eligible: dagRunEligibility.send(parentSessionId, nodeId),
    leaseWhen: (fresh) => fresh.status === "failed",
  })
  switch (acquired.kind) {
    case "acquired":
      return acquired.record.status === "failed"
        ? { kind: "revive", record: acquired.record, leaseTaken: acquired.leaseTaken }
        : { kind: "steer", record: acquired.record }
    case "held":
      throw notOwned(runId, acquired.holderPid)
    case "busy":
      throw runBusy(runId, acquired.operation)
    case "missing":
      throw new DagNodeControlError({ code: "run_not_found", message: `unknown dag run "${runId}"`, runId })
    case "not_eligible": {
      const decision = classifySend(acquired.record, parentSessionId, nodeId)
      if (decision === "guidance") return { kind: "guidance", record: acquired.record }
      throw sendRefusal(runId, nodeId, decision)
    }
  }
}

/**
 * The steer record is written after the child took the message; decided again at that write under
 * the journal's run lock (the send rule and the holder rule, no lease): a run another live process
 * claimed meanwhile, or the user stopped, gets no record of it (#15125).
 */
export function steerRecordRefused(
  options: DagSchedulerOptions,
  nodeId: DagNodeId,
): (fresh: DagRunRecordV1) => boolean {
  const probe = {
    taskManager: options.taskManager,
    hostPid: options.hostPid ?? process.pid,
    isProcessAlive: options.isProcessAlive ?? defaultSignaller.isAlive,
  }
  const eligible = dagRunEligibility.send(options.initialRecord.parentSessionId, nodeId)
  return (fresh) => decideDagRun(fresh, { probe, eligible }).kind !== "free"
}

function sendRefusal(runId: DagRunId, nodeId: DagNodeId, decision: DagSendClass): DagNodeControlError {
  const nodeIds = [nodeId]
  switch (decision) {
    case "other_session":
      return new DagNodeControlError({
        code: "run_not_owned",
        message: `dag run "${runId}" belongs to another session`,
        runId,
      })
    case "completed":
      return new DagNodeControlError({
        code: "node_not_continuable",
        message: `dag run "${runId}" already completed; node "${nodeId}" cannot be steered or revived. Amend the definition or start a new run.`,
        runId,
        nodeIds,
      })
    case "cancelled":
      return new DagNodeControlError({
        code: "node_not_continuable",
        message: `dag run "${runId}" was cancelled; node "${nodeId}" cannot be steered or revived. Retry the node to run it again.`,
        runId,
        nodeIds,
      })
    case "node_not_found":
      return new DagNodeControlError({
        code: "node_not_found",
        message: `unknown dag node "${nodeId}"`,
        runId,
        nodeIds,
      })
    default:
      return new DagNodeControlError({
        code: "node_has_no_task",
        message: `dag node "${nodeId}" never started a child; retry the run to dispatch it`,
        runId,
        nodeIds,
      })
  }
}

function notOwned(runId: DagRunId, holderPid: number): DagNodeControlError {
  return new DagNodeControlError({
    code: "run_not_owned",
    message: `dag run "${runId}" is held by live process ${holderPid}`,
    runId,
  })
}

// A revived child can settle OUTSIDE the live settle loop (the run may already be quiescent): no
// admission pass is necessarily awaiting this task, so the send arms the one watcher that folds its
// new terminal outcome and persists its result exactly once. The fold is a mutation of the run like
// every other: it waits for the run's reservation (#15125), so it is written only after any send of
// this host still in flight, and a revive that send made keeps the lease alive past this fold.
export async function watchRevivedTask(options: DagSchedulerOptions, nodeId: DagNodeId, taskId: string): Promise<void> {
  let settled: TaskRecord | { readonly error: unknown }
  try {
    settled = await options.taskManager.waitFor(taskId)
  } catch (error) {
    settled = { error }
  }
  const runId = options.initialRecord.runId
  const hold = await reserveWhenFree(options.reservations, runId, "revive fold")
  try {
    foldRevived(options, nodeId, taskId, settled)
  } finally {
    hold.release()
  }
}

function foldRevived(
  options: DagSchedulerOptions,
  nodeId: DagNodeId,
  taskId: string,
  settled: TaskRecord | { readonly error: unknown },
): void {
  const now = options.now ?? Date.now
  const runId = options.initialRecord.runId
  if (!stillRevived(currentRecord(options, runId), nodeId, taskId)) return
  if ("error" in settled)
    return failRevivedNode(options, nodeId, taskId, "task_error", controlErrorMessage(settled.error), now)
  if (settled.status === "pending" || settled.status === "running" || settled.status === "paused")
    return failRevivedNode(options, nodeId, taskId, "task_error", `revived task ${taskId} settled nonterminal`, now)
  if (settled.status !== "completed") {
    const failure = revivedTaskFailure(settled.status, settled.error_message)
    return failRevivedNode(options, nodeId, taskId, failure.code, failure.message, now)
  }
  // Persist before the transition: the reducer rebuilds artifact metadata and run stats from the
  // durable copy, so a crash between the two still replays into an identical checkpoint.
  const persisted = persistDagNodeResult({ store: options.store, runId, nodeId, record: settled, now })
  if (persisted.kind === "failed") throw new Error(persisted.diagnostic.message)
  const skip = (fresh: DagRunRecordV1) => !stillRevived(fresh, nodeId, taskId)
  controlJournal(options, currentRecord(options, runId), undefined, skip).append(
    dagNodeTransitionedEvent({ nodeId, from: "running", to: "completed", reason: { kind: "succeeded" } }),
  )
}

// The fold applies only while the node still runs this revived child (decided again under the
// journal's run lock): nothing else may have moved it meanwhile.
function stillRevived(record: DagRunRecordV1, nodeId: DagNodeId, taskId: string): boolean {
  const node = record.nodes.find((entry) => entry.id === nodeId)
  return node?.state === "running" && node.taskId === taskId
}

function failRevivedNode(
  options: DagSchedulerOptions,
  nodeId: DagNodeId,
  taskId: string,
  code: DagNodeErrorCode,
  message: string,
  now: () => number,
): void {
  const runId = options.initialRecord.runId
  const pendingErrors = new Map<DagNodeId, DagNodeError>([
    [nodeId, { code, message, nodeId, at: new Date(now()).toISOString() }],
  ])
  const skip = (fresh: DagRunRecordV1) => !stillRevived(fresh, nodeId, taskId)
  controlJournal(options, currentRecord(options, runId), pendingErrors, skip).append(
    dagNodeTransitionedEvent({ nodeId, from: "running", to: "failed", reason: { kind: "failed" } }),
  )
}

function revivedTaskFailure(
  status: Exclude<TaskStatus, "completed" | "pending" | "running" | "paused">,
  message?: string,
): { readonly code: DagNodeErrorCode; readonly message: string } {
  switch (status) {
    case "error":
      return { code: "task_error", message: message ?? "task failed" }
    case "interrupted":
      return { code: "task_interrupted", message: message ?? "task was interrupted" }
    case "lost":
      return { code: "task_lost", message: message ?? "task was lost" }
    case "cancelled":
      return { code: "task_cancelled", message: message ?? "task was cancelled" }
  }
}
