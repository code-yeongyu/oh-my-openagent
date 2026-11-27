// The park after a repeated scheduler failure ends durably whatever a child or the store does (#15125):
// a child that will not close is reported and its node still fails, so the run never stays `running`
// under this host's lease; any other throw after the acquisition unwinds the lease it wrote.
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"

import { DAG_SCHEDULER_FAILED_PAUSE_REASON } from "../../../../senpi-task/src/dag/events"
import { runId } from "../../../../senpi-task/src/dag/__fixtures__/reattached-run"
import { retryDagNodes } from "../../../../senpi-task/src/dag/node-retry"
import type { DagNodeId } from "../../../../senpi-task/src/dag/types"
import { createDagRunCancel } from "./dag-run-cancel"
import { failedSchedulerRun, THIS_HOST } from "./dag-scheduler-failure.test-support"

const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

async function secondFailure(options: Parameters<typeof failedSchedulerRun>[1]) {
  const run = failedSchedulerRun(cleanupRoots, options)
  await run.fail()
  run.state.held = false
  await run.fail()
  return run
}

function cancelOf(run: ReturnType<typeof failedSchedulerRun>) {
  return createDagRunCancel({
    store: run.base,
    schedulerOptions: run.schedulerOptions,
    schedulers: new Map(),
    reservations: run.reservations,
    holders: { taskManager: run.children, hostPid: THIS_HOST, isProcessAlive: (pid) => pid === THIS_HOST },
    holdsRun: () => false,
  })
}

describe("DAG park after a repeated scheduler failure", () => {
  test("#given a child whose hold will not close #when the run is parked #then it is parked scheduler_failed with no lease, the node failed and the child reported", async () => {
    // given
    const closeHold = async () => {
      throw new Error("task task-only has not ended, so its run hold is still in place")
    }

    // when
    const run = await secondFailure({ closure: { closeHold } })

    // then
    const record = run.read()
    expect(record?.status).toBe("paused")
    expect(record?.leaseHolderPid).toBeUndefined()
    expect(record?.nodes.map((entry) => entry.state)).toEqual(["failed"])
    expect(record?.nodes[0]?.error?.message).toContain("did not close")
    expect(run.events().at(-1)).toEqual(expect.objectContaining({ reason: DAG_SCHEDULER_FAILED_PAUSE_REASON }))
    expect(run.logs.map((entry) => entry.message)).toContain("omo-senpi dag parked run's child did not close")

    // and cancel and retry both work on it
    await cancelOf(run)(runId, run.running.parentSessionId)
    expect(run.read()?.status).toBe("cancelled")
  })

  test("#given a parked run with a child that would not close #when its node is retried #then the run re-enters", async () => {
    const closeHold = async () => {
      throw new Error("not ended")
    }
    const run = await secondFailure({ closure: { closeHold } })
    const reentry = retryDagNodes({ ...run.schedulerOptions, initialRecord: run.read() ?? run.running }, runId, [
      "only" as DagNodeId,
    ])
    // The fake reuses the cancelled child by owner, so only the re-entry itself is asserted here.
    expect(run.events().map((event) => event.type)).toContain("dag.node.retried")
    expect((await reentry.run).status).not.toBe("paused")
  })

  test("#given the pause append fails during the park #when it throws #then this host's lease is unwound and the error is logged", async () => {
    // given - the store refuses the scheduler_failed pause once
    let refused = false
    const run = await secondFailure({
      wrap: (base) => ({
        ...base,
        appendEvent: (event) => {
          if (!refused && event.type === "dag.run.paused") {
            refused = true
            throw new Error("disk I/O failure")
          }
          return base.appendEvent(event)
        },
      }),
    })

    // then - the record stays running with its node failed and no lease; nothing claims it here
    expect(refused).toBe(true)
    expect(run.read()?.leaseHolderPid).toBeUndefined()
    expect(run.read()?.status).toBe("running")
    expect(run.logs).toContainEqual(
      expect.objectContaining({ level: "error", fields: expect.objectContaining({ runId }) }),
    )

    // and cancel works on it; a retry is refused as still running, with its typed code
    const retried = (() => {
      try {
        retryDagNodes({ ...run.schedulerOptions, initialRecord: run.read() ?? run.running }, runId, [
          "only" as DagNodeId,
        ])
        return undefined
      } catch (error) {
        return error
      }
    })()
    expect(retried).toEqual(expect.objectContaining({ code: "run_still_active" }))
    await cancelOf(run)(runId, run.running.parentSessionId)
    expect(run.read()?.status).toBe("cancelled")
  })
})
