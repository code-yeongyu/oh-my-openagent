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
import { acquireDagRun, dagRunEligibility, decideDagRun } from "./run-acquisition"
import type { DagSchedulerOptions } from "./scheduler"
import { type DagNodeError, type DagNodeErrorCode, type DagNodeId, type DagRunId } from "./types"

/**
 * Decides a send on the fresh record under the run lock. A live run is steered without taking it
 * (refused while another live process holds it); a `failed` run is acquired first (holder rule,
 * the verb's reservation, this host's lease), because its child can only be revived, which takes
 * the run over. Returns the record the send must work from, and whether this send wrote the lease
 * (a lease this host already held for another revive stays until that revive's fold).
 */
export function decideSend(
  options: DagSchedulerOptions,
  runId: DagRunId,
  nodeId: DagNodeId,
): { readonly record: DagRunRecordV1; readonly leaseTaken: boolean } {
  const probe = {
    taskManager: options.taskManager,
    hostPid: options.hostPid ?? process.pid,
    isProcessAlive: options.isProcessAlive ?? defaultSignaller.isAlive,
  }
  const parentSessionId = options.initialRecord.parentSessionId
  const steer = options.store.withRunLock(runId, () => {
    const fresh = options.store.readCheckpoint<DagRunRecordV1>(runId)
    if (fresh === null || fresh.status === "failed") return { kind: "revive" as const }
    return { ...decideDagRun(fresh, { probe, eligible: dagRunEligibility.sendSteer(parentSessionId, nodeId) }), fresh }
  })
  if (steer.kind === "free") return { record: steer.fresh, leaseTaken: false }
  if (steer.kind === "held") throw notOwned(runId, steer.holderPid)
  if (steer.kind === "not_eligible") return { record: steer.fresh, leaseTaken: false }
  const acquired = acquireDagRun<DagRunRecordV1>(options.store, runId, {
    operation: "send",
    probe,
    ...(options.reservation === undefined ? {} : { reservation: options.reservation }),
    eligible: dagRunEligibility.sendRevive(parentSessionId, nodeId),
  })
  switch (acquired.kind) {
    case "acquired":
      return { record: acquired.record, leaseTaken: acquired.leaseTaken }
    case "held":
      throw notOwned(runId, acquired.holderPid)
    case "busy":
      throw runBusy(runId, acquired.operation)
    case "missing":
      throw new DagNodeControlError({ code: "run_not_found", message: `unknown dag run "${runId}"`, runId })
    case "not_eligible":
      return { record: acquired.record, leaseTaken: false }
  }
}

function notOwned(runId: DagRunId, holderPid: number): DagNodeControlError {
  return new DagNodeControlError({
    code: "run_not_owned",
    message: `dag run "${runId}" is held by live process ${holderPid}`,
    runId,
  })
}

// A revived child can settle OUTSIDE the live settle loop (the run may already be quiescent):
// no admission pass is necessarily awaiting this task, so the send arms the one watcher that folds
// its new terminal outcome and persists its result exactly once.
export async function watchRevivedTask(options: DagSchedulerOptions, nodeId: DagNodeId, taskId: string): Promise<void> {
  const now = options.now ?? Date.now
  const runId = options.initialRecord.runId
  let task: TaskRecord
  try {
    task = await options.taskManager.waitFor(taskId)
  } catch (error) {
    failRevivedNode(options, nodeId, "task_error", controlErrorMessage(error), now)
    return
  }
  if (task.status === "pending" || task.status === "running" || task.status === "paused") {
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
