import type { ResidencyDenied } from "../manager/types"
import type { OwnedStartResult } from "./owner"
import { errorMessage, failNode, transition, type SchedulerContext } from "./scheduler-context"
import { fenceStaleChildren, resolveAdmissionIdle, supersededChildren } from "./scheduler-cancellation"
import { emitCompletedWaves, emitWaveAdmissions } from "./scheduler-frontier"
import { stillAdmissible } from "./scheduler-self-resume"
import { startSpec, owner, isRunnable } from "./scheduler-start"
import { attachStarted, foldSettlement, nextOwnSettlement, settleOne } from "./scheduler-task-attachment"
import { settleOwnerConflict, stopSupersededClaims, type SupersededStop } from "./scheduler-owner-conflict"
import type { DagNodeId, DagNodeErrorCode } from "./types"

type ResidencyPark = "queued" | "lease" | "failed"
type SupersededStops = ReadonlyMap<string, SupersededStop>
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
    // A denial whose dependency re-opened meanwhile (its child resumed on its own) waits again (#12134).
    const denied = stillAdmissible(context, context.pendingAdmission.splice(0))
    // No node is admitted in a pass after which a superseded or removed-node child is still live
    // (#11381). The fence stops such children under the admission latch, before this batch takes it.
    const stale = supersededChildren(context)
    if (stale.length > 0) {
      const admitting = [...denied, ...readyNodes(context, new Map())]
      if (admitting.length > 0 && (await fenceStaleChildren(context, stale, admitting)).length === 0) {
        return !(context.suspended || context.cancellationStarted)
      }
    }
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
    // A child that went stale mid-batch (an infrastructure retry raised its node's attempt) holds
    // every further admission back to the next pass, whose fence stops it first (#11381).
    let fenceDue = false
    const fenceClear = (): boolean => {
      if (supersededChildren(context).length === 0) return true
      fenceDue = true
      return false
    }
    // The batch's first processing error (a journal or attachment fault while a start is handled, a
    // fold fault while it waits). Every handling step runs through `handle`, so the error is kept
    // here whichever event the batch was waiting on, and from then on the batch only retires: no
    // start is handled or launched, every start still in flight is drained, and the error is thrown
    // once the latch is released - the same writes a batch ending on that error after all its
    // starts had settled would make (#10057 review finding 1).
    let failure: { readonly error: unknown } | undefined
    const handle = (step: () => void): void => {
      if (failure !== undefined) return
      try {
        step()
      } catch (error) {
        failure = { error }
      }
    }
    const admitOne = (
      nodeId: DagNodeId,
      settled: PromiseSettledResult<OwnedStartResult>,
      supersededStops: SupersededStops,
    ): void => {
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
      attachOrFail(context, nodeId, result, supersededStops)
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
          // An automatic infrastructure retry raises execAttempt mid-run, so the failed attempt's
          // child can resume before re-admission (#11381). Its stop belongs to this start, so the
          // batch, which cancel and suspend wait for, holds its latch until the stop has answered.
          let stops: SupersededStops | { readonly error: unknown } = new Map()
          if (settled.status === "fulfilled" && settled.value.kind === "owner_conflict") {
            stops = await stopSupersededClaims(context, [nodeId]).catch((error: unknown) => ({ error }))
          }
          // Leaves the in-flight set in the same step that parks, attaches or fails the node, so a
          // fold can never see it both parked and still in flight.
          inFlight.delete(nodeId)
          handle(() => {
            if ("error" in stops) throw stops.error
            admitOne(nodeId, settled, stops)
          })
        })()
        // The start removes itself in the step that admits it; a later delete here would remove a
        // re-launched start's entry instead (#10057 review D4-H1).
        inFlight.set(nodeId, started)
      }
    }
    const admitReady = (): void => {
      const runnable = readyNodes(context, inFlight)
      if (runnable.length === 0 || !fenceClear()) return
      for (const nodeId of runnable) transition(context, nodeId, "scheduled", { kind: "scheduled" })
      emitWaveAdmissions(context, runnable)
      launch(runnable)
    }

    context.admissionInProgress = true
    try {
      handle(() => {
        launch(denied)
        admitReady()
      })
      while (inFlight.size > 0 && failure === undefined) {
        const next = await Promise.race([
          Promise.race(inFlight.values()).then(() => ({ kind: "start" as const })),
          nextOwnSettlement(context).then((settled) => ({ kind: "settled" as const, settled })),
          // A child attached (or a foreign commit) mid-batch re-arms the race above.
          context.settlementChanged().then(() => ({ kind: "wake" as const })),
        ])
        if (context.suspended || context.cancellationStarted) break
        handle(() => {
          if (next.kind === "settled") {
            foldSettlement(context, next.settled)
            folded = true
            emitCompletedWaves(context)
            // The slot a fold may free goes to the oldest denial first, before the nodes it unblocks.
            // A node parked a microtask ago may still be in flight until its start settles; it stays
            // parked and is retried on the next fold or at the end of the pass.
            // A parked node whose dependency re-opened meanwhile returns to the frontier instead (#12134).
            const waiting = admissionOrder.filter((nodeId) => parked.has(nodeId) && !inFlight.has(nodeId))
            const retry = stillAdmissible(context, waiting)
            for (const nodeId of waiting) if (!retry.includes(nodeId)) parked.delete(nodeId)
            if (retry.length > 0 && fenceClear()) {
              for (const nodeId of retry) parked.delete(nodeId)
              launch(retry)
            }
          }
          if (next.kind !== "start") admitReady()
        })
      }
      // Suspension, cancellation and a processing error all leave starts in flight; each is handled
      // (or, once retiring, skipped) as it returns, and none of them launches another.
      while (inFlight.size > 0) await Promise.all(inFlight.values())
    } finally {
      context.admissionInProgress = false
      resolveAdmissionIdle(context)
    }
    if (failure !== undefined) throw failure.error
    if (context.suspended || context.cancellationStarted) return false
    const nextDenied = admissionOrder.filter((nodeId) => parked.has(nodeId))
    context.pendingAdmission.push(...nextDenied)
    // A fold during the batch may have freed a slot for a parked node, and a held-back admission
    // waits for the next pass's fence: probe again at once.
    if (folded || fenceDue) continue
    if (nextDenied.length === 0) return true
    // A contended or displaced admission lease is a bounded wait inside acquisition itself, so the
    // next probe is already paced; only a cap denial has to wait for a slot to free.
    if (leaseDenied) continue
    if (!(await settleOne(context, residencyReleased))) return false
  }
}

function readyNodes(context: SchedulerContext, inFlight: ReadonlyMap<DagNodeId, unknown>): DagNodeId[] {
  const snapshot = context.journal.snapshot()
  return snapshot.nodes
    .filter(
      (node) =>
        (node.state === "pending" || node.state === "blocked") &&
        !inFlight.has(node.id) &&
        !context.infrastructureRetries.pending(node.id) &&
        isRunnable(snapshot, node.id),
    )
    .map((node) => node.id)
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
  supersededStops: SupersededStops,
): void {
  if (result.kind === "held") {
    context.journal.append({ type: "dag.run.paused", reason: "user_stop", pauseSeq: result.pauseSeq })
    context.suspended = true
    context.resolveCancellationRequested()
    return
  }
  if (result.kind === "owner_conflict") {
    settleOwnerConflict(context, nodeId, result, supersededStops)
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
