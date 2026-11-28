// The failure handler's decision table (#15125): (failure number) x (reservation free or busy) x (what
// the fresh record reads after the wait) -> outcome. A first failure hands the run to recovery, a
// repeated failure of the same sequence parks it, and both wait for the run's reservation first.
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"

import { DAG_SCHEDULER_FAILED_PAUSE_REASON } from "../../../../senpi-task/src/dag/events"
import { runId } from "../../../../senpi-task/src/dag/__fixtures__/reattached-run"
import { failedSchedulerRun, OTHER_HOST } from "./dag-scheduler-failure.test-support"

const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

/** A first failure whose recovery took the run, then that recovered scheduler ended: the next is the second. */
async function afterFirstFailure() {
  const run = failedSchedulerRun(cleanupRoots)
  await run.fail()
  expect(run.state.held).toBe(true)
  run.state.held = false
  return run
}

const pausedBy = (run: ReturnType<typeof failedSchedulerRun>) =>
  run.events().filter((event) => event.type === "dag.run.paused")

describe("DAG scheduler failure handler", () => {
  test("first failure, reservation free, record running: recovery takes the run", async () => {
    const run = failedSchedulerRun(cleanupRoots)
    await run.fail()
    expect(run.recovered).toHaveLength(1)
    expect(run.state.held).toBe(true)
  })

  test("first failure, reservation busy, record still running when it is released: recovery takes it then", async () => {
    const run = failedSchedulerRun(cleanupRoots)
    const send = run.reservations.reserve(runId, "send")
    const handing = run.fail()
    expect(run.recovered).toEqual([])
    send?.release()
    await handing
    expect(run.recovered).toHaveLength(1)
    expect(run.state.held).toBe(true)
  })

  test("first failure, reservation busy with a cancel that cancels the run: nothing handed on, logged", async () => {
    const run = failedSchedulerRun(cleanupRoots)
    const cancel = run.reservations.reserve(runId, "cancel")
    const handing = run.fail()
    run.base.writeCheckpoint(runId, { ...run.running, status: "cancelled" })
    cancel?.release()
    await handing
    expect(run.recovered).toEqual([])
    expect(run.logs.map((entry) => entry.message)).toContain(
      "omo-senpi dag run needs no hand-off after its scheduler failed",
    )
  })

  test("second failure, reservation free, record running: the run is parked", async () => {
    const run = await afterFirstFailure()
    await run.fail()
    expect(run.recovered).toHaveLength(1)
    expect(run.read()?.status).toBe("paused")
    expect(pausedBy(run).at(-1)).toEqual(expect.objectContaining({ reason: DAG_SCHEDULER_FAILED_PAUSE_REASON }))
  })

  test("second failure, reservation busy, record still running when it is released: parked then", async () => {
    const run = await afterFirstFailure()
    const send = run.reservations.reserve(runId, "send")
    const parking = run.fail()
    expect(pausedBy(run)).toEqual([])
    send?.release()
    await parking
    expect(run.read()?.status).toBe("paused")
    expect(run.read()?.nodes.map((entry) => entry.state)).toEqual(["failed"])
    expect(run.children.get("task-only")?.status).toBe("cancelled")
  })

  test("second failure, reservation busy with a cancel that cancels the run: no park, logged", async () => {
    const run = await afterFirstFailure()
    const cancel = run.reservations.reserve(runId, "cancel")
    const parking = run.fail()
    run.base.writeCheckpoint(runId, { ...run.running, status: "cancelled" })
    cancel?.release()
    await parking
    expect(pausedBy(run)).toEqual([])
    expect(run.read()?.status).toBe("cancelled")
    expect(run.logs.map((entry) => entry.message)).toContain(
      "omo-senpi dag run needs no hand-off after its scheduler failed",
    )
  })

  test("second failure, another live process holds the run: not parked, logged, nothing written", async () => {
    const run = await afterFirstFailure()
    run.base.writeCheckpoint(runId, { ...run.running, leaseHolderPid: OTHER_HOST } as typeof run.running)
    await run.fail()
    expect(run.events()).toEqual([])
    expect(run.logs.map((entry) => entry.message)).toContain(
      "omo-senpi dag run not parked: another live process holds it",
    )
  })

  test("a settle between two failures starts a new sequence: the next failure is a first one again", async () => {
    const run = await afterFirstFailure()
    run.handler.settled(runId)
    await run.fail()
    expect(run.recovered).toHaveLength(2)
    expect(pausedBy(run)).toEqual([])
  })

  test("a hand-off that leaves no scheduler of this process holding the run ends the sequence", async () => {
    const run = failedSchedulerRun(cleanupRoots)
    run.base.writeCheckpoint(runId, { ...run.running, status: "cancelled" })
    await run.fail()
    run.base.writeCheckpoint(runId, run.running)
    await run.fail()
    expect(run.recovered).toHaveLength(1)
    expect(pausedBy(run)).toEqual([])
  })

  test("after a park, a re-entry that fails once is a first failure: recovery, not a second park", async () => {
    const run = await afterFirstFailure()
    await run.fail()
    expect(pausedBy(run)).toHaveLength(1)
    run.base.writeCheckpoint(runId, { ...run.running, status: "running" })
    run.state.held = false
    await run.fail()
    expect(run.recovered).toHaveLength(2)
    expect(pausedBy(run)).toHaveLength(1)
  })
})
