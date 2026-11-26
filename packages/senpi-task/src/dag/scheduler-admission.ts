import type { ResidencyDenied } from "../manager/types"
import type { OwnedStartResult } from "./owner"
import { errorMessage, failNode, transition, type SchedulerContext } from "./scheduler-context"
import { resolveAdmissionIdle } from "./scheduler-cancellation"
import { emitCompletedWaves, emitWaveAdmissions } from "./scheduler-frontier"
import { startSpec, owner, isRunnable } from "./scheduler-start"
import { attachStarted, foldSettlement, nextOwnSettlement, settleOne } from "./scheduler-task-attachment"
import type { DagNodeId, DagNodeErrorCode } from "./types"

type ResidencyPark = "queued" | "lease" | "failed"
// One admission pass over the frontier: the ordered residency-denied queue first (oldest denial
// gets the first freed slot), then every newly ready node. The pass stays open while any start is
// in flight; a fold during it re-probes the parked denials first, then admits what it unblocked.
// Denials still parked when the pass ends retry after ANY slot-freeing event in the parent session -
// one of this run's own children settling, or a resident child of another owner (a sibling run, a
// team, a task spawn) settling or being evicted (#8396). A denial that names no resident can never
// be helped by waiting and fails the node. Cancellation aborts the pass without admitting more.
export async function admitFrontier(context: SchedulerContext): Promise<boolean> {
  for (;;) {
    if (context.suspended || context.cancellationStarted) return false
    const denied = context.pendingAdmission.splice(0)
    // Armed BEFORE the probe: the wake is edge-triggered, and a sibling child that settles while
    // this batch is in flight must still be seen, or a run whose last chance passed in that gap
    // parks until an unrelated resident settles.
    const residencyReleased = context.taskManager.residencyChanged(context.journal.snapshot().parentSessionId)
    // #8934: a start can take minutes against a busy task host, so the batch is open-ended. Each
    // start is handled the moment it returns (a node whose child started is attached at once), the
    // run's own children fold the moment they settle, and nodes a fold unblocks join the batch.
    // Denials are collected in admission order, which keeps the residency FIFO.
    const admissionOrder: DagNodeId[] = []
    const parked = new Set<DagNodeId>()
    const inFlight = new Map<DagNodeId, Promise<void>>()
    let leaseDenied = false
    let folded = false
    const admitOne = (nodeId: DagNodeId, settled: PromiseSettledResult<OwnedStartResult>): void => {
      // The task owner record is durable even when admission finishes after suspension. Recovery
      // resolves it by owner; this retired controller must not attach, fail, or promote the node.
      if (context.suspended && !context.cancellationStarted) return
      if (settled.status === "rejected") {
        if (!context.cancellationStarted) failNode(context, nodeId, "start_failed", errorMessage(settled.reason))
        return
      }
      const result = settled.value
      if (context.cancellationStarted) {
        if (result.kind === "started") attachStarted(context, nodeId, result)
        return
      }
      if (result.kind === "residency_denied") {
        const park = parkResidencyDenied(context, nodeId, result)
        if (park === "queued" || park === "lease") parked.add(nodeId)
        if (park === "lease") leaseDenied = true
        return
      }
      context.residencyQueued.delete(nodeId)
      attachOrFail(context, nodeId, result)
    }
    const launch = (nodeIds: readonly DagNodeId[]): void => {
      for (const nodeId of nodeIds) {
        // One start per node at a time; the order records each node once, at its first admission.
        if (inFlight.has(nodeId)) continue
        if (!admissionOrder.includes(nodeId)) admissionOrder.push(nodeId)
        const started = (async () => {
          // Registered below before this body runs: a start that settles synchronously (a throwing
          // spec builder or manager) would otherwise delete its entry before it exists and leave a
          // settled promise in the set for the batch loop to spin on.
          await Promise.resolve()
          let settled: PromiseSettledResult<OwnedStartResult>
          try {
            settled = {
              status: "fulfilled",
              value: await context.taskManager.startOwned(
                {
                  ...startSpec(context, nodeId),
                  ...(context.resumeCredential === undefined ? {} : { resumeCredential: context.resumeCredential }),
                },
                owner(context, nodeId),
              ),
            }
          } catch (reason) {
            settled = { status: "rejected", reason }
          }
          // Leaves the in-flight set in the same step that parks, attaches or fails the node, so a
          // fold can never see it both parked and still in flight.
          inFlight.delete(nodeId)
          admitOne(nodeId, settled)
        })()
        // The start removes itself in the step that admits it; a later delete here would remove a
        // re-launched start's entry instead (#10057 review D4-H1).
        inFlight.set(nodeId, started)
      }
    }
    const admitReady = (): void => {
      const snapshot = context.journal.snapshot()
      const runnable = snapshot.nodes
        .filter(
          (node) =>
            (node.state === "pending" || node.state === "blocked") &&
            !inFlight.has(node.id) &&
            !context.infrastructureRetries.pending(node.id) &&
            isRunnable(snapshot, node.id),
        )
        .map((node) => node.id)
      if (runnable.length === 0) return
      for (const nodeId of runnable) transition(context, nodeId, "scheduled", { kind: "scheduled" })
      emitWaveAdmissions(context, runnable)
      launch(runnable)
    }

    launch(denied)
    admitReady()
    if (inFlight.size === 0) return true
    context.admissionInProgress = true
    try {
      while (inFlight.size > 0) {
        const next = await Promise.race([
          Promise.race(inFlight.values()).then(() => ({ kind: "start" as const })),
          nextOwnSettlement(context).then((settled) => ({ kind: "settled" as const, settled })),
          // A child attached (or a foreign commit) mid-batch re-arms the race above.
          context.settlementChanged().then(() => ({ kind: "wake" as const })),
        ])
        if (context.suspended || context.cancellationStarted) {
          await Promise.all(inFlight.values())
          break
        }
        if (next.kind === "settled") {
          foldSettlement(context, next.settled)
          folded = true
          emitCompletedWaves(context)
          // The slot a fold may free goes to the oldest denial first, before the nodes it unblocks.
          // A node parked a microtask ago may still be in flight until its start settles; it stays
          // parked and is retried on the next fold or at the end of the pass.
          const retry = admissionOrder.filter((nodeId) => parked.has(nodeId) && !inFlight.has(nodeId))
          for (const nodeId of retry) parked.delete(nodeId)
          launch(retry)
        }
        if (next.kind !== "start") admitReady()
      }
    } finally {
      context.admissionInProgress = false
      resolveAdmissionIdle(context)
    }
    if (context.suspended || context.cancellationStarted) return false
    const nextDenied = admissionOrder.filter((nodeId) => parked.has(nodeId))
    context.pendingAdmission.push(...nextDenied)
    // A fold during the batch may have freed a slot for a parked node: probe again at once.
    if (folded) continue
    if (nextDenied.length === 0) return true
    // A contended or displaced admission lease is a bounded wait inside acquisition itself, so the
    // next probe is already paced; only a cap denial has to wait for a slot to free.
    if (leaseDenied) continue
    if (!(await settleOne(context, residencyReleased))) return false
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
