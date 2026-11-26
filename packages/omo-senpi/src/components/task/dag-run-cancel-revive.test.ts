// Pins TODAY's answer, not a desired one: a cancel of a `failed` run while one of its nodes is revived
// is a no-op (the run is settled; unheldCancel is not eligible on a terminal run), so the revived child
// keeps running under this host's lease until its fold drops it. The stacked cancellation PR ("cancel
// stops every child the run owns") decides whether that changes (#15125).
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"

import { sendRun, THIS_HOST } from "../../../../senpi-task/src/dag/__fixtures__/send-run"
import { runId } from "../../../../senpi-task/src/dag/__fixtures__/reattached-run"
import { createDagRunCancel } from "./dag-run-cancel"

const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe("DAG cancel of a failed run with a revived node (current behaviour, pinned)", () => {
  test("#given a revived node of a failed run #when the run is cancelled #then today the cancel is a no-op: the run stays failed, the child keeps running under this host's lease, and its fold drops the lease", async () => {
    // given
    const run = sendRun(cleanupRoots, ["a"])
    const revived = await run.send("a")
    const isProcessAlive = (pid: number): boolean => pid === THIS_HOST
    const cancelRun = createDagRunCancel({
      store: run.base,
      schedulerOptions: {
        reservations: run.reservations,
        store: run.base,
        taskManager: run.manager,
        hostPid: THIS_HOST,
        isProcessAlive,
      },
      schedulers: new Map(),
      reservations: run.reservations,
      holders: { taskManager: run.manager, hostPid: THIS_HOST, isProcessAlive },
      children: run.manager,
      closure: { closeHold: async () => undefined },
      holdsRun: () => false,
    })

    // when
    const cancelled = await cancelRun(runId, run.read()?.parentSessionId ?? "")

    // then
    expect(cancelled).toBeUndefined()
    expect(run.read()).toEqual(expect.objectContaining({ status: "failed", leaseHolderPid: THIS_HOST }))
    expect(run.nodeState("a")).toBe("running")
    run.manager.complete("task-a")
    await revived.settled
    expect(run.nodeState("a")).toBe("completed")
    expect(run.read()?.leaseHolderPid).toBeUndefined()
  })
})
