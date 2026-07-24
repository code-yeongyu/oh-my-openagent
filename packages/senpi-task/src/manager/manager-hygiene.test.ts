import { afterEach, describe, expect, test } from "bun:test"

import { FakeRunner, baseSpec, cleanupProjects, flush, makeManager, settings } from "./__fixtures__/manager-fakes"

afterEach(cleanupProjects)

// F6: the release guard (#released) was a Set keyed by `${taskId}:${epoch}` whose only prune was a
// linear scan in forget(). A resident task revived N times left N epoch keys behind for the whole
// session. The guard is now a Map keyed by taskId (latest released epoch), so growth is bounded by
// the number of distinct live tasks and forget() prunes in O(1).
describe("TaskManager release guard growth", () => {
  test("#given a task revived multiple times #when each run completes #then the release guard keeps one entry per task, not per epoch", async () => {
    // given
    const inProcess = new FakeRunner()
    const { manager } = makeManager({ inProcess, config: settings({ default_concurrency: 5, max_depth: 1 }) })
    const started = await manager.start(baseSpec({ name: "a" }))
    if (started.kind !== "started") throw new Error("expected started")
    const taskId = started.task_id

    // when the task completes, is revived, and completes again — twice
    for (let cycle = 0; cycle < 3; cycle += 1) {
      inProcess.handles.get(taskId)?.settle({ status: "completed", finalResponse: `pass-${cycle}` })
      await flush()
      if (cycle < 2) {
        const revived = await manager.continueTask(taskId, "again", "parent-1")
        if (revived.kind !== "continued") throw new Error("expected continued")
      }
    }

    // then the guard has a single entry for the task (not one per run_epoch)
    expect(manager.releasedKeyCount()).toBe(1)
  })

  test("#given a completed task #when it is forgotten #then the release guard entry is pruned", async () => {
    // given
    const inProcess = new FakeRunner()
    const { manager } = makeManager({ inProcess, config: settings({ default_concurrency: 5, max_depth: 1 }) })
    const started = await manager.start(baseSpec({ name: "a" }))
    if (started.kind !== "started") throw new Error("expected started")
    inProcess.handles.get(started.task_id)?.settle({ status: "completed", finalResponse: "done" })
    await flush()
    expect(manager.releasedKeyCount()).toBe(1)

    // when
    manager.forget(started.task_id)

    // then
    expect(manager.releasedKeyCount()).toBe(0)
  })
})

// F7: #launch subscribed the child's transcript log and DISCARDED the unsubscribe, so the listener
// closure outlived the handle. The manager now owns the unsubscribe and calls it on forget().
describe("TaskManager transcript subscription ownership", () => {
  test("#given a running task with a transcript subscription #when it is forgotten #then the subscription is torn down", async () => {
    // given
    const inProcess = new FakeRunner()
    const { manager } = makeManager({ inProcess, config: settings({ default_concurrency: 5, max_depth: 1 }) })
    const started = await manager.start(baseSpec({ name: "a" }))
    if (started.kind !== "started") throw new Error("expected started")
    const fake = inProcess.handles.get(started.task_id)
    if (fake === undefined) throw new Error("expected live handle")
    expect(fake.subscribeCount()).toBe(1)
    expect(fake.unsubscribeCount()).toBe(0)

    // when
    manager.forget(started.task_id)

    // then
    expect(fake.unsubscribeCount()).toBe(1)
  })
})
