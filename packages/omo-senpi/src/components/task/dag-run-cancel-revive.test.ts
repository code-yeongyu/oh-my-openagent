// A cancel of a `failed` run while one of its nodes is revived by send follows the one cancellation rule
// of the stack (#15125 on #11381): the run owns the revived child, so the cancel stops it through the
// run-wide drain. The settled record keeps its status, the revive watcher's fold records the node's
// outcome, and the lease leaves in that fold. The cancel holds the run's reservation while it stops the
// child and the fold waits for that reservation, so the cancel awaits only the stop, never the fold.
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  categoryNode,
  createE2eFixture,
  definition,
  identityMaterializer,
  parentSessionId,
} from "../../../../senpi-task/src/dag/__fixtures__/controlled-dag-e2e"
import { ControlledRunner, completed, failed } from "../../../../senpi-task/src/dag/__fixtures__/controlled-runner"
import type { DagRunRecordV1 } from "../../../../senpi-task/src/dag/manager"
import { retryDagNodes } from "../../../../senpi-task/src/dag/node-retry"
import { sendToDagNode } from "../../../../senpi-task/src/dag/node-send"
import { createDagRunReservations, reserveWhenFree } from "../../../../senpi-task/src/dag/run-reservations"
import type { DagNodeId, DagRunId } from "../../../../senpi-task/src/dag/types"
import { createDagRunCancel } from "./dag-run-cancel"

setDefaultTimeout(process.platform === "win32" ? 60_000 : 20_000)

const THIS_HOST = process.pid
const OTHER_HOST = THIS_HOST + 1
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

type Leased = DagRunRecordV1 & { readonly leaseHolderPid?: number }

async function failedRunWithRevivedA() {
  const root = fs.mkdtempSync(join(tmpdir(), "omo-dag-cancel-revive-"))
  roots.push(root)
  const runner = new ControlledRunner()
  const fixture = createE2eFixture({ project: root, runner, materializeSkills: identityMaterializer })
  const started = await fixture.start(definition("cancel-revive", [categoryNode("A"), categoryNode("B")]))
  const runId = started.snapshot.runId
  await runner.whenStarted(2)
  runner.settle("A", completed("A"))
  runner.settle("B", failed("B"))
  expect((await fixture.wait(runId)).status).toBe("failed")
  const taskA = fixture.taskManager.findOwnedTask({ kind: "dag", runId, nodeId: "A" as DagNodeId })?.task_id ?? ""
  const reservations = createDagRunReservations()
  const alive = (pid: number): boolean => pid === THIS_HOST || pid === OTHER_HOST
  const options = { store: fixture.store, taskManager: fixture.taskManager, hostPid: THIS_HOST, isProcessAlive: alive }
  const reservation = await reserveWhenFree(reservations, runId, "send")
  const revived = await sendToDagNode(
    { ...options, initialRecord: fixture.manager.record(runId, parentSessionId), reservation, reservations },
    runId,
    "A" as DagNodeId,
    "one more pass",
  ).finally(() => reservation.release())
  const cancelRun = createDagRunCancel({
    store: fixture.store,
    schedulerOptions: options,
    schedulers: new Map(),
    reservations,
    holders: { taskManager: fixture.taskManager, hostPid: THIS_HOST, isProcessAlive: alive },
    holdsRun: () => false,
  })
  const read = () => fixture.store.readCheckpoint<Leased>(runId)
  const nodeA = () => read()?.nodes.find((node) => node.id === "A")
  const otherRetry = () =>
    retryDagNodes({ ...options, hostPid: OTHER_HOST, initialRecord: fixture.manager.record(runId, parentSessionId) }, runId, [
      "B" as DagNodeId,
    ])
  return { fixture, runner, runId: runId as DagRunId, taskA, revived, cancelRun, read, nodeA, otherRetry }
}

describe("DAG cancel of a failed run with a revived node", () => {
  test("#given a revived node of a failed run held under this host's lease #when the run is cancelled #then the cancel stops the child, the run stays failed, the fold records the node's outcome and drops the lease, and another host's retry is accepted", async () => {
    // given
    const run = await failedRunWithRevivedA()
    expect(run.revived.delivery).toBe("revive")
    expect(run.read()).toMatchObject({ status: "failed", leaseHolderPid: THIS_HOST })
    expect(run.nodeA()?.state).toBe("running")

    // when
    const cancelled = await run.cancelRun(run.runId, parentSessionId, "stop the run")
    const childAfterCancel = run.fixture.taskStore.load(run.taskA)?.status
    if (childAfterCancel !== "cancelled") run.runner.settle("A", completed("A again"))
    await run.revived.settled

    // then
    expect(cancelled).toBeUndefined()
    expect(childAfterCancel).toBe("cancelled")
    expect(run.read()?.status).toBe("failed")
    expect(run.nodeA()).toMatchObject({ state: "failed", taskId: run.taskA })
    expect(run.read()?.leaseHolderPid).toBeUndefined()
    expect(run.fixture.manager.snapshot(run.runId, parentSessionId).outstandingStop).toBeUndefined()
    const retried = run.otherRetry()
    expect(run.read()).toMatchObject({ status: "running", leaseHolderPid: OTHER_HOST })
    await retried.scheduler.cancel(run.runId, "end the test")
  })

  test("#given a revived node whose stop is held at a gate #when the run is cancelled #then the cancel does not settle and the node runs under this host's lease until the stop lands, then it is folded and the lease leaves", async () => {
    // given
    const run = await failedRunWithRevivedA()
    const held = run.runner.child("A").holdStops()

    // when
    let settled = false
    const cancelling = run.cancelRun(run.runId, parentSessionId, "stop the run").then(() => {
      settled = true
    })
    await held.reached
    const whileGated = { settled, node: run.nodeA()?.state, lease: run.read()?.leaseHolderPid }
    held.release()
    await cancelling
    await run.revived.settled

    // then
    expect(whileGated).toEqual({ settled: false, node: "running", lease: THIS_HOST })
    expect(run.read()?.status).toBe("failed")
    expect(run.nodeA()?.state).toBe("failed")
    expect(run.read()?.leaseHolderPid).toBeUndefined()
  })
})
