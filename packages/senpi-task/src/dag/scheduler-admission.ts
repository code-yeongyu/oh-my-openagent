import type { ResidencyDenied } from "../manager/types"
import type { OwnedStartResult } from "./owner"
import { errorMessage, failNode, isLiveTask, transition, type SchedulerContext } from "./scheduler-context"
import { resolveAdmissionIdle } from "./scheduler-cancellation"
import { emitWaveAdmissions } from "./scheduler-frontier"
import { startSpec, owner, isRunnable } from "./scheduler-start"
import { attachStarted, settleOne } from "./scheduler-task-attachment"
import type { DagNodeId, DagNodeErrorCode } from "./types"

type ResidencyPark = "queued" | "lease" | "failed"
export async function admitFrontier(context: SchedulerContext): Promise<boolean> {
  for (;;) {
    if (context.suspended || context.cancellationStarted) return false
    const denied = context.pendingAdmission.splice(0)
    const deniedIds = new Set(denied)
    const snapshot = context.journal.snapshot()
    const runnable = snapshot.nodes
      .filter((node) =>
        (node.state === "pending" || node.state === "blocked") &&
        !deniedIds.has(node.id) &&
        !context.infrastructureRetries.pending(node.id) &&
        isRunnable(snapshot, node.id))
      .map((node) => node.id)
    if (denied.length === 0 && runnable.length === 0) return true

    for (const nodeId of runnable) transition(context, nodeId, "scheduled", { kind: "scheduled" })
    emitWaveAdmissions(context, runnable)

    // Armed BEFORE the probe: the wake is edge-triggered, and a sibling child that settles while
    // this batch is in flight must still be seen, or a run whose last chance passed in that gap
    // parks until an unrelated resident settles.
    const residencyReleased = context.taskManager.residencyChanged(snapshot.parentSessionId)
    const awaitingAdmission = [...denied, ...runnable]
    context.admissionInProgress = true
    let results: PromiseSettledResult<{ readonly nodeId: DagNodeId; readonly result: OwnedStartResult }>[]
    const supersededStops = new Map<string, PromiseSettledResult<unknown>>()
    try {
      results = await Promise.allSettled(awaitingAdmission.map(async (nodeId) => ({
        nodeId,
        result: await context.taskManager.startOwned({
          ...startSpec(context, nodeId),
          ...(context.resumeCredential === undefined ? {} : { resumeCredential: context.resumeCredential }),
        }, owner(context, nodeId)),
      })))
      // An automatic infrastructure retry raises execAttempt mid-run, so the failed attempt's child
      // can resume before re-admission (#11381). Stop it inside the admission pass, which cancel and
      // suspend wait for, before its node fails.
      const superseded = results.flatMap((settled) =>
        settled.status === "fulfilled" && settled.value.result.kind === "owner_superseded" ? [settled.value.result.task_id] : [])
      const stops = await Promise.allSettled(superseded.map((taskId) =>
        context.taskManager.cancelTask(taskId, "superseded by a newer attempt of its DAG node")))
      superseded.forEach((taskId, index) => {
        const stop = stops[index]
        if (stop !== undefined) supersededStops.set(taskId, stop)
      })
    } finally {
      context.admissionInProgress = false
      resolveAdmissionIdle(context)
    }
    // The task owner record is durable even when admission finishes after suspension. Recovery
    // resolves it by owner; this retired controller must not attach, fail, or promote the node.
    if (context.suspended && !context.cancellationStarted) return false
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
        attachOrFail(context, nodeId, result, supersededStops)
      }
    }
    if (context.cancellationStarted) return false
    context.pendingAdmission.push(...nextDenied)
    if (nextDenied.length === 0) return true
    // A contended or displaced admission lease is a bounded wait inside acquisition itself, so the
    // next probe is already paced; only a cap denial has to wait for a slot to free.
    if (leaseDenied) continue
    if (!await settleOne(context, residencyReleased)) return false
  }
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
  supersededStops: ReadonlyMap<string, PromiseSettledResult<unknown>>,
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
  if (result.kind === "owner_superseded") {
    const stop = supersededStops.get(result.task_id)
    const message = isLiveTask(context.taskManager.get(result.task_id))
      ? `task ${result.task_id} of a superseded attempt is still live and could not be stopped${stop?.status === "rejected" ? `: ${errorMessage(stop.reason)}` : ""}`
      : `task ${result.task_id} of a superseded attempt was live at admission and has been stopped`
    failNode(context, nodeId, "stale_attempt_alive", message)
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
    case "owner_superseded":
      // Handled by attachOrFail, which stops the child first; kept for exhaustiveness (#11381).
      return { code: "stale_attempt_alive", message: `task ${result.task_id} of a superseded attempt is still live` }
    default:
      return assertNever(result)
  }
}
