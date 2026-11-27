// The control verbs ask the one holder rule (#15125); for a lease-less run it names the live foreign
// owner of a node's current child, judged as the lifecycle judges it (#12077). A pid the OS gave to
// another process, whose start contradicts the claim's stamp, holds nothing, so no verb is refused
// `run_not_owned` on it; the owner whose start matches still holds the run.
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createDagManager, type DagRunId, type DagRunRecordV1 } from "@oh-my-opencode/senpi-task/dag"

import {
  LongRunningTaskManager,
  node,
  owner,
  pausedRecord,
  runId,
  taskRecord,
} from "../../../../senpi-task/src/dag/__fixtures__/reattached-run"
import { createDagRunReservations } from "../../../../senpi-task/src/dag/run-reservations"
import { createDagFileStore } from "../../../../senpi-task/src/dag/store"
import { createOwnerProcessView } from "../../../../senpi-task/src/lifecycle/owner-process"
import type { CancelOutcome, SendInput, SendOutcome } from "../../../../senpi-task/src/steering"
import { ownedTaskState } from "../../../../senpi-task/src/store/__fixtures__/owned-task-state"
import { createDagRunCancel } from "./dag-run-cancel"
import { createDagRuntimeControls } from "./dag-runtime-controls"
import type { OwnedScheduler } from "./dag-scheduler-registry"

const THIS_HOST = 101
const OWNER_PID = 9002
const CLAIMED_START = "linux-proc-start-ticks:100"
const REUSED_START = "linux-proc-start-ticks:999"
const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

/** A run left `running` with no lease, whose `slow` child the OS now reports under `observedStart`. */
function leaseLessRun(observedStart: string) {
  const directory = fs.mkdtempSync(join(tmpdir(), "omo-senpi-dag-reused-owner-"))
  cleanupRoots.push(directory)
  const store = createDagFileStore(ownedTaskState(directory))
  const { previousLeaseHolderPid: _previous, ...paused } = pausedRecord(
    { key: "reused-owner", name: "reused owner", nodes: [node("slow"), node("next", ["slow"])] },
    { slow: { state: "running", taskId: "task-slow", attempt: 1 }, next: { state: "pending" } },
  )
  const record: DagRunRecordV1 = { ...paused, status: "running" }
  store.writeCheckpoint(runId, record)
  const manager = new LongRunningTaskManager()
  manager.add({
    ...taskRecord(owner("slow"), "running", "task-slow"),
    host_pid: OWNER_PID,
    host_claim: { pid: OWNER_PID, at: "2026-08-25T00:00:00.000Z", start: CLAIMED_START },
  })
  const taskManager = Object.assign(manager, {
    sendToTask: async (input: SendInput): Promise<SendOutcome> => ({
      kind: "steered",
      task_id: input.idOrName,
      status: "running",
      delivered: "steer",
    }),
    cancelTask: async (taskId: string): Promise<CancelOutcome> => {
      const task = manager.get(taskId)
      if (task === undefined) return { kind: "not_found", reason: `unknown task ${taskId}` }
      manager.add({ ...task, status: "cancelled" })
      return { kind: "cancelled", task_id: taskId, previous_status: task.status }
    },
  })
  const starts = new Map([[OWNER_PID, observedStart]])
  const reservations = createDagRunReservations()
  const schedulerOptions = {
    store,
    taskManager,
    hostPid: THIS_HOST,
    isProcessAlive: (pid: number) => pid === THIS_HOST || pid === OWNER_PID,
    ownerProcesses: createOwnerProcessView(async (pid) => starts.get(pid) ?? null),
    reservations,
  }
  const schedulers = new Map<DagRunId, OwnedScheduler>()
  const controls = createDagRuntimeControls({
    coreManager: createDagManager({ store }),
    schedulerOptions,
    schedulers,
    reservations,
    holdsRun: () => false,
    sessionId: () => record.parentSessionId,
    clearAdmissionLatch: () => undefined,
    adoptReentry: () => undefined,
  })
  const cancel = createDagRunCancel({
    store,
    schedulerOptions,
    schedulers,
    reservations,
    holders: schedulerOptions,
    holdsRun: () => false,
  })
  const refusalOf = async (operation: () => Promise<unknown>): Promise<{ readonly code?: string } | undefined> => {
    try {
      await operation()
      return undefined
    } catch (error) {
      return error as { readonly code?: string }
    }
  }
  return {
    retry: () => refusalOf(() => controls.retry(runId, ["slow"])),
    send: () => refusalOf(() => controls.send(runId, "slow", "keep going")),
    cancel: () => refusalOf(() => cancel(runId, record.parentSessionId, "stop")),
    read: () => store.readCheckpoint<DagRunRecordV1>(runId),
  }
}

describe("DAG control verbs on a lease-less run whose child names a reused owner pid", () => {
  test("#given the child's owner pid is alive but its start contradicts the claim's stamp #when retry, send and cancel run #then none is refused as owned by that pid and the cancel ends the run", async () => {
    // given
    const run = leaseLessRun(REUSED_START)

    // when
    const retried = await run.retry()
    const sent = await run.send()
    const cancelled = await run.cancel()

    // then
    expect({
      retryRefusedAsOwned: retried?.code === "run_not_owned",
      send: sent?.code,
      cancel: cancelled?.code,
      status: run.read()?.status,
    }).toEqual({ retryRefusedAsOwned: false, send: undefined, cancel: undefined, status: "cancelled" })
  })

  test("#given the child's owner pid is alive and its start matches the claim's stamp #when retry, send and cancel run #then each is refused naming that live owner and the run is untouched", async () => {
    // given
    const run = leaseLessRun(CLAIMED_START)
    const before = run.read()

    // when
    const refusals = [await run.retry(), await run.send(), await run.cancel()]

    // then
    for (const refusal of refusals) {
      expect(refusal).toEqual(
        expect.objectContaining({ code: "run_not_owned", message: expect.stringContaining(String(OWNER_PID)) }),
      )
    }
    expect(run.read()).toEqual(before)
  })
})
