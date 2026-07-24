import { afterEach, describe, expect, test } from "bun:test"

import { FakeRunner, baseSpec, cleanupProjects, flush, makeManager, settings } from "./__fixtures__/manager-fakes"

afterEach(cleanupProjects)

// Regression for the inherited todo-9 defect: #releaseSlot was guarded by a task_id-only Set that
// was never reset, so a revived task that re-acquires a slot could never release it again (the
// later release collapsed to a no-op) and leaked the slot forever. The guard is now keyed by
// run_epoch, so each revive's occupancy releases independently.
describe("TaskManager revive concurrency slot", () => {
  test("#given single concurrency #when a revived task completes #then it releases its slot and a queued task starts", async () => {
    // given a single-slot manager: task A runs, completes (slot freed), then is revived
    const inProcess = new FakeRunner()
    const { manager, store } = makeManager({
      inProcess,
      config: settings({ default_concurrency: 1, max_depth: 1 }),
    })
    const a = await manager.start(baseSpec({ name: "a" }))
    if (a.kind !== "started") throw new Error("expected started")
    inProcess.handles.get(a.task_id)?.settle({ status: "completed", finalResponse: "first" })
    await flush()
    expect(store.load(a.task_id)?.status).toBe("completed")

    const revived = await manager.continueTask(a.task_id, "again", "parent-1")
    if (revived.kind !== "continued") throw new Error("expected continued")
    expect(revived.delivered).toBe("revive")
    expect(store.load(a.task_id)?.notification.run_epoch).toBe(1)

    // when a second task is queued behind the revived (slot-occupying) task A
    const b = await manager.start(baseSpec({ name: "b" }))
    if (b.kind !== "started") throw new Error("expected started")
    expect(b.status).toBe("pending")

    // when the revived task A completes a second time, releasing the re-acquired slot
    inProcess.handles.get(a.task_id)?.settle({ status: "completed", finalResponse: "second" })
    await flush()
    await flush()

    // then the queued task B is granted the freed slot and starts running (no leaked slot)
    expect(store.load(b.task_id)?.status).toBe("running")
  })

  test("#given single concurrency #when a task is interrupted #then its slot is released for the next task", async () => {
    // given a single-slot manager with a running task A
    const inProcess = new FakeRunner()
    const { manager, store } = makeManager({
      inProcess,
      config: settings({ default_concurrency: 1, max_depth: 1 }),
    })
    const a = await manager.start(baseSpec({ name: "a" }))
    if (a.kind !== "started") throw new Error("expected started")

    // when A is interrupted (a terminal, slot-freeing transition)
    const interrupted = await manager.interruptTask({ idOrName: a.task_id, callerSessionId: "parent-1" })
    expect(interrupted.kind).toBe("interrupted")

    // then a new task B acquires the freed slot immediately (running, not queued)
    const b = await manager.start(baseSpec({ name: "b" }))
    if (b.kind !== "started") throw new Error("expected started")
    expect(b.status).toBe("running")
    expect(store.load(a.task_id)?.status).toBe("interrupted")
  })
})
