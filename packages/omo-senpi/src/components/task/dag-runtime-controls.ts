import type { DagManager, DagRunRecordV1 } from "../../../../senpi-task/src/dag/manager"
import type { DagNodeId, DagRunId, DagRunSnapshot } from "../../../../senpi-task/src/dag/types"
import type { DagDefinition } from "@oh-my-opencode/senpi-task/dag"
import {
  reenterDagRun,
  type DagNodeSendResult,
  type DagRunReentry,
  type DagScheduler,
  type DagSchedulerOptions,
} from "../../../../senpi-task/src/dag/scheduler"
import { retryDagNodes } from "../../../../senpi-task/src/dag/node-retry"
import { sendToDagNode } from "../../../../senpi-task/src/dag/node-send"
import { applyPausedDagGuidance, type PausedDagGuideCommand } from "../../../../senpi-task/src/dag/paused-controls"
import {
  acquireReentryLease,
  refuseUnheldActiveNodes,
  runBusy,
} from "../../../../senpi-task/src/dag/node-control-context"
import type { DagRunReservation, DagRunReservations } from "../../../../senpi-task/src/dag/run-acquisition"
import { createPausedNodeCancel, type PausedNodeHoldPort } from "./dag-paused-cancel"

type OwnedScheduler = { readonly scheduler: DagScheduler; running?: Promise<DagRunRecordV1> }

/**
 * The model-driven verbs (retry, send, amend, guide) and the user's node cancel. Each holds the run's in-process reservation for
 * its whole operation, so it never overlaps a recovery installation, another verb or a cancel of this
 * process; a run already reserved refuses with the retryable `run_busy` naming the operation in
 * flight (#15125). A verb on a run this host does not hold calls the engine verb with options and
 * builds no scheduler; only a held run's own scheduler serves a verb.
 */
export function createDagRuntimeControls(ports: {
  readonly coreManager: DagManager
  readonly schedulerOptions: Omit<DagSchedulerOptions, "initialRecord">
  readonly schedulers: Map<DagRunId, OwnedScheduler>
  readonly reservations: DagRunReservations
  holdsRun(runId: DagRunId): boolean
  sessionId(): string
  clearAdmissionLatch(runId: DagRunId): void
  adoptReentry(runId: DagRunId, reentry: DagRunReentry): void
  readonly closure?: PausedNodeHoldPort
}) {
  const { coreManager, schedulerOptions, schedulers, clearAdmissionLatch, adoptReentry } = ports

  const reserved = async <T>(
    runId: DagRunId,
    operation: string,
    verb: (reservation: DagRunReservation) => Promise<T> | T,
  ) => {
    const reservation = ports.reservations.reserve(runId, operation)
    if (reservation === undefined) throw runBusy(runId, ports.reservations.inFlight(runId) ?? operation)
    try {
      return await verb(reservation)
    } finally {
      reservation.release()
    }
  }

  const retry = (runId: DagRunId, nodeIds?: readonly string[], options?: { readonly prompt?: string }) =>
    reserved(runId, "retry", (reservation): DagRunSnapshot => {
      const sessionId = ports.sessionId()
      const record = coreManager.record(runId, sessionId)
      // Node ids arrive as untrusted tool JSON; the engine's branded id is a compile-time tag over the
      // same string, and the engine itself rejects an id no node carries.
      const targets = nodeIds as readonly DagNodeId[] | undefined
      const verbOptions = { ...schedulerOptions, initialRecord: record, reservation }
      if (record.pause?.reason !== "user_stop") clearAdmissionLatch(runId)
      const reentry = retryDagNodes(
        verbOptions,
        runId,
        targets,
        options?.prompt === undefined ? undefined : { prompt: options.prompt },
      )
      if (record.pause?.reason !== "user_stop" && reentry.record.pause?.reason !== "user_stop")
        adoptReentry(runId, reentry)
      return coreManager.snapshot(runId, sessionId)
    })

  const send = (runId: DagRunId, nodeId: string, message: string): Promise<DagNodeSendResult> =>
    reserved(runId, "send", (reservation) => {
      const held = ports.holdsRun(runId) ? schedulers.get(runId) : undefined
      if (held !== undefined) return held.scheduler.sendToNode(runId, nodeId as DagNodeId, message)
      const record = coreManager.record(runId, ports.sessionId())
      return sendToDagNode(
        { ...schedulerOptions, initialRecord: record, reservation },
        runId,
        nodeId as DagNodeId,
        message,
      )
    })

  const amend = (runId: DagRunId, definition: DagDefinition) =>
    reserved(runId, "amend", async (reservation): Promise<DagRunSnapshot> => {
      const sessionId = ports.sessionId()
      const current = coreManager.record(runId, sessionId)
      refuseUnheldActiveNodes(current)
      // An amend that re-enters the run owns it (lease and reservation) before the amendment is written.
      const options = { ...schedulerOptions, initialRecord: current, reservation }
      const { abandon } =
        current.pause?.reason === "user_stop" ? { abandon: () => undefined } : acquireReentryLease(options, runId)
      try {
        const amended = await coreManager.amend({ runId, definition, parentSessionId: sessionId })
        clearAdmissionLatch(runId)
        schedulers.delete(runId)
        if (amended.pause?.reason !== "user_stop")
          adoptReentry(runId, reenterDagRun({ ...schedulerOptions, initialRecord: amended, reservation }))
      } catch (error) {
        abandon()
        throw error
      }
      return coreManager.snapshot(runId, sessionId)
    })

  const guide = (runId: DagRunId, command: PausedDagGuideCommand) =>
    reserved(runId, "guidance", () => {
      const record = coreManager.record(runId, ports.sessionId())
      return applyPausedDagGuidance({ ...schedulerOptions, initialRecord: record }, runId, command)
    })

  const pausedNodeCancel = createPausedNodeCancel(
    (runId) => ({ ...schedulerOptions, initialRecord: coreManager.record(runId, ports.sessionId()) }),
    ports.closure,
  )
  const cancelNode = (runId: DagRunId, nodeId: string): Promise<void> =>
    reserved(runId, "cancel_node", () => pausedNodeCancel(runId, nodeId))

  return { retry, send, amend, guide, cancelNode }
}
