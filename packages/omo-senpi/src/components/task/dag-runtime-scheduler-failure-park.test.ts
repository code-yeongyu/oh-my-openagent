// The SAME run's scheduler fails twice in this live process: first the run is handed to recovery, which
// follows its live child again; when that recovered scheduler fails too, the run is parked for good:
// its live child is stopped (two schedulers in a row could not follow it), its node fails with the real
// error, and the lease leaves. The park leaves no active node, so the bound is durable (in the record,
// not in memory): a later automatic recovery resumes it once, admits nothing, and settles it `failed`;
// after that nothing automatic touches it, and only retry or amend runs it again (#15125).
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"

import { DAG_SCHEDULER_FAILED_PAUSE_REASON } from "../../../../senpi-task/src/dag/events"
import { within } from "./dag-runtime-recovery.test-support"
import { failingScheduler } from "./dag-runtime-scheduler-failure.test-support"

const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

async function parkedRun(name: string) {
  const run = await failingScheduler(cleanupRoots, name, 2)
  await within(run.parked, "the run parked after the second failure")
  return run
}

describe("DAG runtime when the recovered scheduler of the same run fails again", () => {
  test("#given the same run's scheduler failed twice #then it is parked scheduler_failed with no lease, its node failed and its child stopped", async () => {
    const run = await parkedRun("park")
    const childId = run.runner.handles[0]?.spec.taskId ?? ""

    expect(run.read()?.status).toBe("paused")
    expect(run.runEvents().at(-1)).toEqual(
      expect.objectContaining({ type: "dag.run.paused", reason: DAG_SCHEDULER_FAILED_PAUSE_REASON }),
    )
    expect(run.read()?.leaseHolderPid).toBeUndefined()
    expect(run.read()?.nodes.map((node) => node.state)).toEqual(["failed"])
    expect(run.engine.manager.get(childId)?.status).toBe("cancelled")
    // The first failure handed the run to recovery, which resumed it once; nothing resumed it after.
    expect(run.runEvents().filter((event) => event.type === "dag.run.resumed")).toHaveLength(1)
    run.runtime.dispose()
  })

  test("#given a scheduler_failed park #when the session starts again, twice #then recovery settles it failed without starting a child, then leaves it alone", async () => {
    const run = await parkedRun("no-loop")
    const before = run.runEvents().length

    await within(run.runtime.attach(), "re-attach")
    await within(run.runtime.wait(run.runId, run.sessionId), "the recovered run settling")
    expect(
      run
        .runEvents()
        .slice(before)
        .map((event) => event.type),
    ).toEqual(["dag.run.resumed", "dag.run.failed"])
    expect(run.read()?.status).toBe("failed")
    expect(run.runner.handles).toHaveLength(1)

    const settled = run.runEvents().length
    await within(run.runtime.attach(), "a further session start")
    expect(run.runEvents()).toHaveLength(settled)
    run.runtime.dispose()
  })

  test("#given a scheduler_failed park #when it is cancelled #then it reads cancelled", async () => {
    const run = await parkedRun("cancel")

    await within(run.runtime.cancel(run.runId), "runtime.cancel")

    expect(run.read()?.status).toBe("cancelled")
    run.runtime.dispose()
  })

  test("#given a scheduler_failed park #when its failed node is retried #then the run re-enters and completes", async () => {
    const run = await parkedRun("retry")

    await within(run.runtime.retry(run.runId), "runtime.retry")
    await within(run.runner.whenStarted(2), "the retried child starting")
    run.runner.handles[1]?.settle("done")
    const result = await within(run.runtime.wait(run.runId, run.sessionId), "the retried run settling")

    expect(result.status).toBe("completed")
    run.runtime.dispose()
  })
})
