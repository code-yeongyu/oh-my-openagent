// A scheduler of this live process ends with an error instead of settling its run (a fault while it
// follows an admitted child). The run must not stay `running` with nothing driving it until the next
// session start: the place that learns the scheduler ended hands the run to recovery, which claims a
// `running` run no scheduler here holds and follows its live children again (#15125).
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"

import { within } from "./dag-runtime-recovery.test-support"
import { failingScheduler as failingSchedulerIn } from "./dag-runtime-scheduler-failure.test-support"

const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

const failingScheduler = (name: string) => failingSchedulerIn(cleanupRoots, name)

describe("DAG runtime after a scheduler of this process fails", () => {
  test("#given the scheduler failed while its child runs #when the child settles #then this process follows it again and the run completes", async () => {
    // given
    const run = await failingScheduler("redrive")

    // when
    run.runner.handles[0]?.settle("done")
    const result = await within(run.runtime.wait(run.runId, run.sessionId), "the run settling after the failure")

    // then
    expect(result.status).toBe("completed")
    expect(run.read()?.status).toBe("completed")
    run.runtime.dispose()
  })

  test("#given the scheduler failed while its child runs #when the run is cancelled #then the run reads cancelled and its child is cancelled", async () => {
    // given
    const run = await failingScheduler("cancel")
    const taskId = run.runner.handles[0]?.spec.taskId

    // when
    await within(run.runtime.cancel(run.runId), "runtime.cancel")

    // then
    expect(run.read()?.status).toBe("cancelled")
    expect(run.engine.manager.get(taskId ?? "")?.status).toBe("cancelled")
    expect(run.read()?.nodes.some((node) => node.state === "running" || node.state === "scheduled")).toBe(false)
    run.runtime.dispose()
  })
})
