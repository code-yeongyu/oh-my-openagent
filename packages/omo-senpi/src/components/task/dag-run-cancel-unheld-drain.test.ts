import { afterEach, expect, setDefaultTimeout, test } from "bun:test"
import * as fs from "node:fs"

import { parentSessionId } from "../../../../senpi-task/src/dag/__fixtures__/controlled-dag-e2e"
import { THIS_HOST, unscheduledRun } from "../../../../senpi-task/src/dag/__fixtures__/stack-composition"
import { createDagRunCancel } from "./dag-run-cancel"

setDefaultTimeout(process.platform === "win32" ? 60_000 : 20_000)

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

// One cancellation rule (#11381 on #15125): the cancel of a run no scheduler holds ends every child
// the run owns through the run-wide drain, not only the children its current nodes name.
test("#given a parked run that still owns a live child of a node an amendment removed #when the run is cancelled by a process that holds no scheduler #then that child is stopped too and the run is journaled cancelled", async () => {
  // given
  const run = await unscheduledRun(roots, ["A", "X"])
  run.write("paused", { A: { state: "running", taskId: run.taskOf("A") } })
  const cancelRun = createDagRunCancel({
    store: run.fixture.store,
    schedulerOptions: run.options,
    schedulers: new Map(),
    reservations: run.reservations,
    holders: { taskManager: run.fixture.taskManager, hostPid: THIS_HOST, isProcessAlive: run.options.isProcessAlive },
    holdsRun: () => false,
  })

  // when
  const outcome = await cancelRun(run.runId, parentSessionId, "stop the run").then(
    () => "cancelled",
    (error: Error) => error.message,
  )

  // then
  expect(outcome).toBe("cancelled")
  expect(run.fixture.taskStore.load(run.taskOf("X"))?.status).toBe("cancelled")
  expect(run.fixture.taskStore.load(run.taskOf("A"))?.status).toBe("cancelled")
  expect(run.read()).toMatchObject({ status: "cancelled" })
  expect(run.read()?.leaseHolderPid).toBeUndefined()
})
