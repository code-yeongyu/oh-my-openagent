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

type OwnedScheduler = { readonly scheduler: DagScheduler; running?: Promise<DagRunRecordV1> }

export function createDagRuntimeControls(ports: {
  readonly coreManager: DagManager
  readonly schedulerOptions: Omit<DagSchedulerOptions, "initialRecord">
  readonly schedulers: Map<DagRunId, OwnedScheduler>
  sessionId(): string
  controller(runId: DagRunId, parentSessionId: string): OwnedScheduler | Promise<OwnedScheduler>
  clearAdmissionLatch(runId: DagRunId): void
  adoptReentry(runId: DagRunId, reentry: DagRunReentry): void
}) {
  const { coreManager, schedulerOptions, schedulers, controller, clearAdmissionLatch, adoptReentry } = ports
  const retry = async (
    runId: DagRunId,
    nodeIds?: readonly string[],
    options?: { readonly prompt?: string },
  ): Promise<DagRunSnapshot> => {
    const sessionId = ports.sessionId()
    const record = coreManager.record(runId, sessionId)
    const targets = nodeIds as readonly DagNodeId[] | undefined
    if (record.pause?.reason === "user_stop") {
      await schedulerOptions.store.withAsyncJournalLock(runId, () =>
        retryDagNodes({ ...schedulerOptions, initialRecord: record }, runId, targets, options),
      )
      return coreManager.snapshot(runId, sessionId)
    }
    clearAdmissionLatch(runId)
    const owned = controller(runId, sessionId)
    const { scheduler } = owned instanceof Promise ? await owned : owned
    // Node ids arrive as untrusted tool JSON; the engine's branded id is a compile-time tag over the
    // same string, and the engine itself rejects an id no node carries.
    const reentry = await schedulerOptions.store.withAsyncJournalAndSessionLock(runId, sessionId, () =>
      options?.prompt === undefined
        ? scheduler.retryNode(runId, targets)
        : scheduler.retryNode(runId, targets, { prompt: options.prompt }),
    )
    if (reentry.record.pause?.reason !== "user_stop") adoptReentry(runId, reentry)
    return coreManager.snapshot(runId, sessionId)
  }

  const send = async (runId: DagRunId, nodeId: string, message: string): Promise<DagNodeSendResult> => {
    const sessionId = ports.sessionId()
    const record = coreManager.record(runId, sessionId)
    if (record.pause?.reason === "user_stop")
      return sendToDagNode({ ...schedulerOptions, initialRecord: record }, runId, nodeId as DagNodeId, message)
    const owned = controller(runId, sessionId)
    return (owned instanceof Promise ? await owned : owned).scheduler.sendToNode(runId, nodeId as DagNodeId, message)
  }

  const amend = async (runId: DagRunId, definition: DagDefinition): Promise<DagRunSnapshot> => {
    const sessionId = ports.sessionId()
    const amended = await coreManager.amend({ runId, definition, parentSessionId: sessionId })
    clearAdmissionLatch(runId)
    schedulers.delete(runId)
    if (amended.pause?.reason !== "user_stop")
      adoptReentry(
        runId,
        await schedulerOptions.store.withAsyncJournalAndSessionLock(runId, sessionId, () =>
          reenterDagRun({ ...schedulerOptions, initialRecord: amended }),
        ),
      )
    return coreManager.snapshot(runId, sessionId)
  }

  const guide = async (runId: DagRunId, command: PausedDagGuideCommand) => {
    const record = coreManager.record(runId, ports.sessionId())
    return schedulerOptions.store.withAsyncJournalLock(runId, () =>
      applyPausedDagGuidance({ ...schedulerOptions, initialRecord: record }, runId, command),
    )
  }

  return { retry, send, amend, guide }
}
