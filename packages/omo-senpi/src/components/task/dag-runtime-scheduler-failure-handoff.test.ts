// The scheduler-failure hand-off waits for the run's reservation before it acts, on both branches: a
// send holding the reservation when the scheduler fails must not make the hand-off (first failure) or
// the park (repeated failure) be skipped for good (#15125).
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"

import { DAG_SCHEDULER_FAILED_PAUSE_REASON } from "../../../../senpi-task/src/dag/events"
import { within } from "./dag-runtime-recovery.test-support"
import { failingScheduler } from "./dag-runtime-scheduler-failure.test-support"

const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe("DAG scheduler-failure hand-off while a send holds the run", () => {
  test("#given a send holding the run when its scheduler fails #when the send finishes #then recovery claims the run and follows its child, with no new attach", async () => {
    // given
    const run = await failingScheduler(cleanupRoots, "handoff-busy", ["later"], { gateSend: true })
    await within(run.laterArmed, "the scheduler following the child")
    const sending = run.runtime.send(run.runId, "only", "keep going")
    await within(run.sendEntered, "the send at its gate")
    run.fail()
    await within(run.failure(1), "the scheduler failing")

    // when
    run.openSend()
    await within(sending, "the send")
    run.runner.handles[0]?.settle("done")
    const result = await within(run.runtime.wait(run.runId, run.sessionId), "the run settling")

    // then
    expect(run.runEvents().map((event) => event.type)).toContain("dag.run.resumed")
    expect(result.status).toBe("completed")
    run.runtime.dispose()
  })

  test("#given a send holding the run when its recovered scheduler fails again #when the send finishes #then the run is parked scheduler_failed, its child stopped and its node failed", async () => {
    // given
    const run = await failingScheduler(cleanupRoots, "park-busy", ["now", "later"], { gateSend: true })
    await within(run.failure(1), "the first failure")
    await within(run.laterArmed, "the recovered scheduler following the child")
    const sending = run.runtime.send(run.runId, "only", "keep going")
    await within(run.sendEntered, "the send at its gate")
    run.fail()
    await within(run.failure(2), "the second failure")

    // when
    run.openSend()
    await within(sending, "the send")
    await within(run.parked, "the park")

    // then
    expect(run.runEvents().at(-1)).toEqual(
      expect.objectContaining({ type: "dag.run.paused", reason: DAG_SCHEDULER_FAILED_PAUSE_REASON }),
    )
    expect(run.read()?.nodes.map((node) => node.state)).toEqual(["failed"])
    expect(run.engine.manager.get(run.runner.handles[0]?.spec.taskId ?? "")?.status).toBe("cancelled")
    expect(run.read()?.leaseHolderPid).toBeUndefined()
    run.runtime.dispose()
  })
})
