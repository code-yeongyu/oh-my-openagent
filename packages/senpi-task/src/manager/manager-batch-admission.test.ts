import { afterEach, describe, expect, test } from "bun:test"

import {
  FakeRunner,
  baseSpec,
  cleanupProjects,
  makeManager,
  settings,
} from "./__fixtures__/manager-fakes"

afterEach(cleanupProjects)

// Scale characterization for the uncapped batch contract (#9854): the per-call batch cap is gone, so a
// wave larger than the run limit must be admitted by the existing queue - at most the limit live at
// once, FIFO grants, every child completing. Guards the machinery the cap removal relies on.
describe("TaskManager batch admission at scale", () => {
  test("#given 40 children under a global run limit of 3 #when they settle in start order #then at most 3 run at once, the rest queue in FIFO order, and all 40 complete", async () => {
    const inProcess = new FakeRunner()
    const { manager, store } = makeManager({
      inProcess,
      config: settings({ default_concurrency: 5, global_concurrency: 3, max_depth: 1 }),
    })

    const TOTAL = 40
    const starts = []
    for (let index = 0; index < TOTAL; index += 1) {
      starts.push(await manager.start(baseSpec({ name: `w${index}` })))
    }
    const startOrderIds = starts.map((start) => (start.kind === "started" ? start.task_id : "failed"))

    // Exactly the run limit launches; the rest queue with a position, in start order.
    expect(inProcess.startedSpecs.map((spec) => spec.taskId)).toEqual(startOrderIds.slice(0, 3))
    const statuses = starts.map((start) => (start.kind === "started" ? start.status : "failed"))
    expect(statuses.slice(0, 3)).toEqual(["running", "running", "running"])
    expect(statuses.slice(3)).toEqual(Array.from({ length: TOTAL - 3 }, () => "pending"))
    const positions = starts.map((start) => (start.kind === "started" ? start.queue_position : undefined))
    expect(positions.slice(0, 3)).toEqual([undefined, undefined, undefined])
    expect(positions.slice(3)).toEqual(Array.from({ length: TOTAL - 3 }, (_, index) => index + 1))

    // Settle in start order; every settle admits exactly one queued child until the wave is launched.
    for (let index = 0; index < TOTAL; index += 1) {
      const started = starts[index]
      if (started?.kind !== "started") throw new Error(`start ${index} failed`)
      const handle = inProcess.handles.get(started.task_id)
      if (handle === undefined) throw new Error(`expected a handle for ${started.task_id}`)
      const waiting = manager.waitFor(started.task_id)
      handle.settle({ status: "completed", finalResponse: `done:${index}` })
      expect((await waiting).status).toBe("completed")
      expect(inProcess.startedSpecs).toHaveLength(Math.min(TOTAL, 3 + index + 1))
      // Never more than the run limit live at once (started minus settled).
      expect(inProcess.startedSpecs.length - (index + 1)).toBeLessThanOrEqual(3)
    }

    // Grant order is FIFO across the whole wave, and every record reached completed.
    expect(inProcess.startedSpecs.map((spec) => spec.taskId)).toEqual(startOrderIds)
    const finalStatuses = starts.map((start) =>
      start.kind === "started" ? store.load(start.task_id)?.status : "missing",
    )
    expect(finalStatuses).toEqual(Array.from({ length: TOTAL }, () => "completed"))
  })
})
