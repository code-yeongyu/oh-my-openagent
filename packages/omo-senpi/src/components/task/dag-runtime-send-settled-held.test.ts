// A send on a run whose scheduler is still registered here although its run has just settled `failed`
// (the registry drops the entry only after the scheduler idles). A settled run takes the one send path:
// the decision and the fold that wait on the runtime's reservations, so the first revive's fold cannot
// drop the lease while a second revive-send is in flight (#15125).
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"

import { createDagManager, type DagRunId, type DagRunRecordV1 } from "@oh-my-opencode/senpi-task/dag"

import { runId } from "../../../../senpi-task/src/dag/__fixtures__/reattached-run"
import { sendRun, THIS_HOST, type SendAnswer } from "../../../../senpi-task/src/dag/__fixtures__/send-run"
import { createDagRunReservations } from "../../../../senpi-task/src/dag/run-reservations"
import { createDagScheduler } from "../../../../senpi-task/src/dag/scheduler"
import { createDagRuntimeControls } from "./dag-runtime-controls"
import type { OwnedScheduler } from "./dag-scheduler-registry"

const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe("DAG runtime send while the settled run's scheduler is still registered", () => {
  test("#given a registered scheduler whose run just settled failed #when A revives, B's revive is in flight and A's child settles first #then the lease stays this host's until B's fold", async () => {
    // given - B's task manager answer waits at a gate
    let openB = (): void => undefined
    const gateB = new Promise<void>((resolve) => (openB = resolve))
    let markB = (): void => undefined
    const enteredB = new Promise<void>((resolve) => (markB = resolve))
    const answer = async (taskId: string): Promise<SendAnswer> => {
      if (taskId !== "task-b") return "revived"
      markB()
      await gateB
      return "revived"
    }
    const run = sendRun(cleanupRoots, ["a", "b", "c"], { answer })
    const isProcessAlive = (pid: number): boolean => pid === THIS_HOST
    const schedulerOptions = {
      store: run.base,
      taskManager: run.manager,
      hostPid: THIS_HOST,
      isProcessAlive,
      reservations: run.reservations,
    }
    // The settled run's scheduler, built without the runtime's registry, is still registered.
    const settled = run.read() as DagRunRecordV1
    const held: OwnedScheduler = {
      scheduler: createDagScheduler({
        ...schedulerOptions,
        reservations: createDagRunReservations(),
        initialRecord: settled,
      }),
      running: new Promise<DagRunRecordV1>(() => undefined),
    }
    const schedulers = new Map<DagRunId, OwnedScheduler>([[runId, held]])
    const controls = createDagRuntimeControls({
      coreManager: createDagManager({ store: run.base }),
      schedulerOptions,
      schedulers,
      reservations: run.reservations,
      holdsRun: (id) => schedulers.get(id)?.running !== undefined,
      sessionId: () => settled.parentSessionId,
      clearAdmissionLatch: () => undefined,
      adoptReentry: () => undefined,
    })

    // when
    const revivedA = await controls.send(runId, "a", "again")
    const sendingB = controls.send(runId, "b", "again")
    await enteredB
    run.manager.complete("task-a")
    await run.manager.waitFor("task-a")
    openB()
    const revivedB = await sendingB

    // then
    expect(revivedA.delivery).toBe("revive")
    expect(revivedB.delivery).toBe("revive")
    expect(run.read()?.leaseHolderPid).toBe(THIS_HOST)
    await revivedA.settled
    expect(run.read()?.leaseHolderPid).toBe(THIS_HOST)
    run.manager.complete("task-b")
    await revivedB.settled
    expect(run.read()?.leaseHolderPid).toBeUndefined()
    await held.scheduler.suspend()
  })
})
