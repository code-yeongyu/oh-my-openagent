import type { ResidencyDenied } from "../manager/types"
import type { OwnedStartResult } from "./owner"
import { errorMessage, failNode, transition, type SchedulerContext } from "./scheduler-context"
import { resolveAdmissionIdle } from "./scheduler-cancellation"
import { emitWaveAdmissions } from "./scheduler-frontier"
import { startSpec, owner, isRunnable } from "./scheduler-start"
import { attachStarted, settleOne } from "./scheduler-task-attachment"
import type { DagNodeId, DagNodeErrorCode } from "./types"

type ResidencyPark = "queued" | "lease" | "failed"
type AdmissionResult = PromiseSettledResult<{ readonly nodeId: DagNodeId; readonly result: OwnedStartResult }>

export async function admitFrontier(context: SchedulerContext): Promise<boolean> {
  for (;;) {
    const prepared = context.journal.transact(() => prepareAdmission(context))
    const admission = prepared instanceof Promise ? await prepared : prepared
    if (admission === undefined) return false
    if (admission === null) return true
    const { awaitingAdmission, residencyReleased } = admission
    let folded
    try {
      if (context.suspended || context.cancellationStarted) return false
      const results = await Promise.allSettled(
        awaitingAdmission.map(async (nodeId) => ({
          nodeId,
          result: await context.taskManager.startOwned(
            {
              ...startSpec(context, nodeId),
              ...(context.resumeCredential === undefined ? {} : { resumeCredential: context.resumeCredential }),
            },
            owner(context, nodeId),
          ),
        })),
      )
      const committed = context.journal.transact(() => foldAdmission(context, awaitingAdmission, results))
      folded = committed instanceof Promise ? await committed : committed
    } finally {
      context.admissionInProgress = false
      resolveAdmissionIdle(context)
    }
    if (folded === undefined || context.suspended || context.cancellationStarted) return false
    context.pendingAdmission.push(...folded.nextDenied)
    if (folded.nextDenied.length === 0) return true
    // A contended or displaced admission lease is a bounded wait inside acquisition itself, so the
    // next probe is already paced; only a cap denial has to wait for a slot to free.
    if (folded.leaseDenied) continue
    if (!(await settleOne(context, residencyReleased))) return false
  }
}

function prepareAdmission(context: SchedulerContext) {
  if (context.suspended || context.cancellationStarted) return undefined
  const denied = context.pendingAdmission.splice(0)
  const deniedIds = new Set(denied)
  const snapshot = context.journal.snapshot()
  const runnable = snapshot.nodes
    .filter(
      (node) =>
        (node.state === "pending" || node.state === "blocked") &&
        !deniedIds.has(node.id) &&
        !context.infrastructureRetries.pending(node.id) &&
        isRunnable(snapshot, node.id),
    )
    .map((node) => node.id)
  if (denied.length === 0 && runnable.length === 0) return null

  for (const nodeId of runnable) transition(context, nodeId, "scheduled", { kind: "scheduled" })
  emitWaveAdmissions(context, runnable)

  // Armed BEFORE the probe: a sibling's settlement while this batch is in flight must wake it.
  const residencyReleased = context.taskManager.residencyChanged(snapshot.parentSessionId)
  context.admissionInProgress = true
  return { awaitingAdmission: [...denied, ...runnable], residencyReleased }
}

function foldAdmission(
  context: SchedulerContext,
  awaitingAdmission: readonly DagNodeId[],
  results: readonly AdmissionResult[],
) {
  // Recovery resolves the durable task owner if admission finished after suspension. A retired
  // scheduler must not attach, fail, or promote the node.
  if (context.suspended && !context.cancellationStarted) return undefined
  const nextDenied: DagNodeId[] = []
  let leaseDenied = false
  for (let index = 0; index < results.length; index += 1) {
    const settled = results[index]
    const nodeId = awaitingAdmission[index]
    if (settled === undefined || nodeId === undefined) throw new Error("DAG admission result lost its node")
    if (settled.status === "rejected") {
      if (!context.cancellationStarted) failNode(context, nodeId, "start_failed", errorMessage(settled.reason))
      continue
    }
    const { result } = settled.value
    if (context.cancellationStarted) {
      if (result.kind === "started") attachStarted(context, nodeId, result)
    } else if (result.kind === "residency_denied") {
      const parked = parkResidencyDenied(context, nodeId, result)
      if (parked === "queued") nextDenied.push(nodeId)
      if (parked === "lease") {
        nextDenied.push(nodeId)
        leaseDenied = true
      }
    } else {
      context.residencyQueued.delete(nodeId)
      attachOrFail(context, nodeId, result)
    }
  }
  return { nextDenied, leaseDenied }
}

function parkResidencyDenied(context: SchedulerContext, nodeId: DagNodeId, denial: ResidencyDenied): ResidencyPark {
  switch (denial.cause) {
    case "lease":
      return "lease"
    case "residents": {
      if (denial.residents.length === 0) {
        context.residencyQueued.delete(nodeId)
        failNode(
          context,
          nodeId,
          "residency_denied",
          `resident child cap reached and the denial names no resident child that could free a slot: ${denial.reason}`,
        )
        return "failed"
      }
      if (!context.residencyQueued.has(nodeId)) {
        context.residencyQueued.add(nodeId)
        const ownTaskIds = new Set(context.attachedTaskIds.values())
        context.journal.append({
          type: "dag.node.transitioned",
          nodeId,
          from: "scheduled",
          to: "scheduled",
          reason: {
            kind: "residency_queued",
            residents: denial.residents.length,
            heldByOtherOwners: denial.residents.filter((resident) => !ownTaskIds.has(resident.task_id)).length,
          },
        })
      }
      return "queued"
    }
    default:
      return assertNever(denial)
  }
}

function assertNever(value: never): never {
  throw new Error(`unexpected residency denial ${JSON.stringify(value)}`)
}

function attachOrFail(
  context: SchedulerContext,
  nodeId: DagNodeId,
  result: Exclude<OwnedStartResult, { readonly kind: "residency_denied" }>,
): void {
  if (result.kind === "held") {
    context.journal.append({ type: "dag.run.paused", reason: "user_stop", pauseSeq: result.pauseSeq })
    context.suspended = true
    context.resolveCancellationRequested()
    return
  }
  if (result.kind === "owner_conflict") {
    attachStarted(context, nodeId, {
      kind: "started",
      reused: true,
      task_id: result.task_id,
      status: "running",
      name: result.task_id,
    })
    return
  }
  if (result.kind !== "started") {
    const failure = startFailure(result)
    failNode(context, nodeId, failure.code, failure.message)
    if (result.kind === "start_failed") {
      const task = context.taskManager.get(result.task_id)
      if (task !== undefined && task !== null) context.infrastructureRetries.retry(nodeId, task)
    }
    return
  }

  attachStarted(context, nodeId, result)
}

function startFailure(result: Exclude<OwnedStartResult, { readonly kind: "started" | "residency_denied" | "held" }>): {
  readonly code: DagNodeErrorCode
  readonly message: string
} {
  switch (result.kind) {
    case "depth_denied":
      return { code: "depth_denied", message: result.reason }
    case "plan_unresolved":
      return { code: "plan_unresolved", message: result.error.message }
    case "start_failed":
      return { code: "start_failed", message: result.error_message }
    case "owner_conflict":
      return { code: "start_failed", message: `DAG task owner conflicts with existing task ${result.task_id}` }
    default:
      return assertNever(result)
  }
}
