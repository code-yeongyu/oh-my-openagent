import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import * as fs from "node:fs"

import { parentSessionId } from "../../../../senpi-task/src/dag/__fixtures__/controlled-dag-e2e"
import { DEAD_HOST, THIS_HOST, unscheduledRun } from "../../../../senpi-task/src/dag/__fixtures__/stack-composition"
import { DAG_SCHEDULER_FAILED_PAUSE_REASON } from "../../../../senpi-task/src/dag/events"
import { endedChildClosure } from "./dag-paused-cancel"
import { createSchedulerFailureHandler } from "./dag-scheduler-failure"

setDefaultTimeout(process.platform === "win32" ? 60_000 : 20_000)

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

// The second-failure park is one more road that ends a run's children (#15125 under #11381): it stops
// them through the one run-wide drain, so a child the run owns that no node's current claim names is
// stopped too, and a node whose child does not stop is never journaled failed as if it had.
async function runLeftRunningByAFailedScheduler(
  options: { readonly connectable?: boolean; readonly cancelRejectsAfterStopping?: boolean } = {},
) {
  const run = await unscheduledRun(roots, ["A", "X"], options)
  const errors: string[] = []
  const state = { held: false }
  const taskManager = new Proxy(run.options.taskManager, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property, target)
      if (property !== "cancelTask" || options.cancelRejectsAfterStopping !== true || typeof value !== "function")
        return typeof value === "function" ? value.bind(target) : value
      return async (...args: unknown[]) => {
        await value.apply(target, args)
        throw new Error("the cancel's reply was lost")
      }
    },
  })
  run.write("running", { A: { state: "running", taskId: run.taskOf("A") } }, { leaseHolderPid: DEAD_HOST })
  const handler = createSchedulerFailureHandler({
    schedulerOptions: { ...run.options, taskManager },
    reservations: run.reservations,
    probe: { taskManager: run.fixture.taskManager, hostPid: THIS_HOST, isProcessAlive: run.options.isProcessAlive },
    logger: { info: () => undefined, warn: () => undefined, error: (message: string) => void errors.push(message) },
    holdsRun: () => state.held,
    children: taskManager,
    closure: endedChildClosure(taskManager),
    // This session's recovery takes the run; its scheduler then fails too (the second of one sequence).
    recover: async () => {
      state.held = true
    },
  })
  const failTwice = async () => {
    await handler.failed(run.runId, parentSessionId, "fault")
    state.held = false
    await handler.failed(run.runId, parentSessionId, "fault")
  }
  const taskStatus = (id: string) => run.fixture.taskStore.load(run.taskOf(id))?.status
  const lastEvent = () => run.fixture.store.readEvents(run.runId, 0, { limit: 50 }).events.at(-1)
  return { run, failTwice, taskStatus, lastEvent, errors }
}

describe("the second scheduler failure parks the run through the one drain", () => {
  test("#given a run whose removed node's child is still live #when its scheduler fails a second time #then the park stops that child too, fails the node whose child stopped, and pauses the run without a lease", async () => {
    // given
    const { run, failTwice, taskStatus, lastEvent } = await runLeftRunningByAFailedScheduler()

    // when
    await failTwice()

    // then
    expect(taskStatus("X")).toBe("cancelled")
    expect(taskStatus("A")).toBe("cancelled")
    expect(run.read()?.nodes.map((node) => node.state)).toEqual(["failed"])
    expect(run.read()).toMatchObject({ status: "paused" })
    expect(run.read()?.leaseHolderPid).toBeUndefined()
    expect(lastEvent()).toMatchObject({ type: "dag.run.paused", reason: DAG_SCHEDULER_FAILED_PAUSE_REASON })
  })

  test("#given a node whose child's stop stays pending #when the scheduler fails a second time #then that node is not journaled failed, and the run is still paused without a lease", async () => {
    // given
    const { run, failTwice, lastEvent } = await runLeftRunningByAFailedScheduler({ connectable: true })
    run.runner.child("A").connection.lose()

    // when
    await failTwice()

    // then
    expect(run.read()?.nodes.map((node) => node.state)).toEqual(["running"])
    expect(run.read()).toMatchObject({ status: "paused" })
    expect(run.read()?.leaseHolderPid).toBeUndefined()
    expect(lastEvent()).toMatchObject({ type: "dag.run.paused", reason: DAG_SCHEDULER_FAILED_PAUSE_REASON })
  })

  test("#given children whose stops land but whose cancel calls reject #when the scheduler fails a second time #then their nodes are failed, the rejection is reported, and no survivor is", async () => {
    // given
    const { run, failTwice, taskStatus, errors } = await runLeftRunningByAFailedScheduler({
      cancelRejectsAfterStopping: true,
    })

    // when
    await failTwice()

    // then
    expect(taskStatus("A")).toBe("cancelled")
    expect(run.read()?.nodes.map((node) => node.state)).toEqual(["failed"])
    expect(errors).toEqual(["omo-senpi dag run park: stopping the run's children was rejected"])
  })
})
