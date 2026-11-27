// A failed DAG run whose nodes each have a finished, resident child, sent to as the runtime's send verb
// does (#15125): every send holds the run's reservation for its whole operation, and the task manager
// answers each send through `answer`, which a test can gate.
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { SendInput, SendOutcome } from "../../steering"
import { ownedTaskState } from "../../store/__fixtures__/owned-task-state"
import type { DagRunRecordV1 } from "../manager"
import { retryDagNodes } from "../node-retry"
import { sendToDagNode } from "../node-send"
import { createDagRunReservations, reserveWhenFree } from "../run-reservations"
import { createDagFileStore, type DagFileStore } from "../store"
import type { DagNodeId } from "../types"
import { LongRunningTaskManager, node, owner, pausedRecord, runId, taskRecord } from "./reattached-run"

export const THIS_HOST = 101
const OTHER_HOST = 202
export const LIVE_THIRD_HOST = 303

export type Leased = DagRunRecordV1 & { readonly leaseHolderPid?: number; readonly previousLeaseHolderPid?: number }
export type SendAnswer = "revived" | "refused" | "steered"

export function sendRun(
  cleanupRoots: string[],
  nodeIds: readonly string[],
  options: {
    readonly answer?: (taskId: string) => SendAnswer | Promise<SendAnswer>
    readonly wrap?: (base: DagFileStore) => DagFileStore
    readonly record?: (failed: DagRunRecordV1) => Leased
  } = {},
) {
  const directory = fs.mkdtempSync(join(tmpdir(), "senpi-dag-send-run-"))
  cleanupRoots.push(directory)
  const base = createDagFileStore(ownedTaskState(directory))
  const states = Object.fromEntries(
    nodeIds.map((id) => [id, { state: "failed" as const, taskId: `task-${id}`, attempt: 1 }]),
  )
  const { previousLeaseHolderPid: _previous, ...paused } = pausedRecord(
    { key: "send-run", name: "send run", nodes: nodeIds.map((id) => node(id)) },
    states,
  )
  const failed: DagRunRecordV1 = { ...paused, status: "failed" }
  base.writeCheckpoint(runId, options.record?.(failed) ?? failed)
  const sends: SendInput[] = []
  const leaseAtSend: Array<number | undefined> = []
  const manager = new LongRunningTaskManager()
  for (const id of nodeIds) manager.add(taskRecord(owner(id), "completed", `task-${id}`))
  const taskManager = Object.assign(manager, {
    sendToTask: async (input: SendInput): Promise<SendOutcome> => {
      sends.push(input)
      leaseAtSend.push(base.readCheckpoint<Leased>(runId)?.leaseHolderPid)
      const answer = (await options.answer?.(input.idOrName)) ?? "revived"
      if (answer === "steered")
        return { kind: "steered", task_id: input.idOrName, status: "running", delivered: "steer" }
      if (answer === "refused")
        return { kind: "not_continuable", task_id: input.idOrName, reason: "refused", suggestion: "retry" }
      const record = manager.get(input.idOrName)
      if (record !== undefined) manager.add({ ...record, status: "running" })
      return { kind: "revived", task_id: input.idOrName, run_epoch: 2 }
    },
  })
  const reservations = createDagRunReservations()
  const alive = (pid: number): boolean => pid === THIS_HOST || pid === LIVE_THIRD_HOST
  const store = options.wrap?.(base) ?? base
  const send = async (nodeId: string) => {
    const reservation = await reserveWhenFree(reservations, runId, "send")
    try {
      const initialRecord = base.readCheckpoint<DagRunRecordV1>(runId) ?? failed
      return await sendToDagNode(
        { store, taskManager, hostPid: THIS_HOST, isProcessAlive: alive, initialRecord, reservation, reservations },
        runId,
        nodeId as DagNodeId,
        "again",
      )
    } finally {
      reservation.release()
    }
  }
  const otherRetry = (nodeId: string) =>
    retryDagNodes(
      {
        reservations: reservations,
        store: base,
        taskManager,
        hostPid: OTHER_HOST,
        isProcessAlive: alive,
        initialRecord: failed,
      },
      runId,
      [nodeId as DagNodeId],
    )
  const refusalOf = async (operation: () => unknown): Promise<unknown> => {
    try {
      await operation()
      return undefined
    } catch (error) {
      return error
    }
  }
  const read = () => base.readCheckpoint<Leased>(runId)
  const events = () => base.readEvents(runId, 0, { limit: 500 }).events
  const nodeState = (nodeId: string) => read()?.nodes.find((entry) => entry.id === nodeId)?.state
  return { base, manager, sends, leaseAtSend, reservations, send, otherRetry, refusalOf, read, events, nodeState }
}
