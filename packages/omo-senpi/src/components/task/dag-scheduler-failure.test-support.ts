import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createDagFileStore, type DagFileStore, type DagRunRecordV1 } from "@oh-my-opencode/senpi-task/dag"

import {
  LongRunningTaskManager,
  node,
  owner,
  pausedRecord,
  runId,
  taskRecord,
} from "../../../../senpi-task/src/dag/__fixtures__/reattached-run"
import { createDagRunReservations } from "../../../../senpi-task/src/dag/run-reservations"
import type { PausedNodeHoldPort } from "./dag-paused-cancel"
import { createSchedulerFailureHandler } from "./dag-scheduler-failure"

export const THIS_HOST = 101
export const OTHER_HOST = 303

/**
 * A `running` run whose scheduler in this process just ended with an error: node `only` runs child
 * `task-only` owned by this host. `recover` stands in for this session's recovery: it takes the run
 * (this host now holds it) only while the fresh record still reads `running` with no lease.
 */
export function failedSchedulerRun(
  cleanupRoots: string[],
  options: {
    readonly lease?: number
    readonly closure?: PausedNodeHoldPort
    readonly wrap?: (base: DagFileStore) => DagFileStore
    readonly directory?: string
    readonly recover?: (sessionId: string) => Promise<void>
  } = {},
) {
  const directory = options.directory ?? fs.mkdtempSync(join(tmpdir(), "omo-senpi-dag-scheduler-failure-handler-"))
  if (options.directory === undefined) cleanupRoots.push(directory)
  const base = createDagFileStore({ project_dir: directory })
  const store = options.wrap?.(base) ?? base
  const { previousLeaseHolderPid: _previous, ...paused } = pausedRecord(
    { key: "failure", name: "failure", nodes: [node("only")] },
    { only: { state: "running", taskId: "task-only", attempt: 1 } },
  )
  const running = {
    ...paused,
    status: "running",
    ...(options.lease === undefined ? {} : { leaseHolderPid: options.lease }),
  } as DagRunRecordV1
  base.writeCheckpoint(runId, running)
  const manager = new LongRunningTaskManager()
  manager.add({ ...taskRecord(owner("only"), "running", "task-only"), host_pid: THIS_HOST })
  const children = Object.assign(manager, {
    cancelTask: async (taskId: string) => {
      const record = manager.get(taskId)
      if (record !== undefined) manager.add({ ...record, status: "cancelled" })
      return { kind: "cancelled" as const, task_id: taskId, previous_status: "running" as const }
    },
  })
  const reservations = createDagRunReservations()
  const logs: Array<{ readonly level: string; readonly message: string; readonly fields?: Record<string, unknown> }> =
    []
  const log = (level: string) => (message: string, fields?: Record<string, unknown>) =>
    void logs.push({ level, message, ...(fields === undefined ? {} : { fields }) })
  const recovered: string[] = []
  const state = { held: false }
  const read = () => base.readCheckpoint<DagRunRecordV1 & { readonly leaseHolderPid?: number }>(runId)
  const isProcessAlive = (pid: number): boolean => pid === THIS_HOST || pid === OTHER_HOST
  const schedulerOptions = { store, taskManager: children, hostPid: THIS_HOST, isProcessAlive, reservations }
  const handler = createSchedulerFailureHandler({
    schedulerOptions,
    reservations,
    probe: { taskManager: children, hostPid: THIS_HOST, isProcessAlive },
    logger: { info: log("info"), warn: log("warn"), error: log("error") },
    holdsRun: () => state.held,
    children,
    closure: options.closure ?? { closeHold: async () => undefined },
    recover: async (sessionId) => {
      recovered.push(sessionId)
      if (options.recover !== undefined) return options.recover(sessionId)
      const fresh = read()
      if (fresh?.status === "running" && fresh.leaseHolderPid === undefined) state.held = true
    },
  })
  const fail = () => handler.failed(runId, running.parentSessionId, "fault")
  const events = () => base.readEvents(runId, 0, { limit: 100 }).events
  return {
    directory,
    base,
    store,
    running,
    children,
    reservations,
    handler,
    fail,
    recovered,
    state,
    read,
    events,
    logs,
    schedulerOptions,
  }
}
