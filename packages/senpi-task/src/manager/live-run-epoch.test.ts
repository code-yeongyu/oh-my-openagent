import { afterEach, describe, expect, test } from "bun:test"

import { coldReviveHarness } from "../lifecycle/__fixtures__/cold-revive-harness"
import { LEGACY_RUN_START_EPOCH, type TaskRecord } from "../state"
import { bounded, fixture, poolInput } from "../workpool/__fixtures__/admission"
import { FakeRunner, baseSpec, cleanupProjects, flush, makeManager } from "./__fixtures__/manager-fakes"

afterEach(cleanupProjects)

// The footer's subagent cost (senpi#2471) takes a run's live figure only when the tracker names the
// record's CURRENT run, so every place that creates a tracker must tag it with the run it measures.
// A wrong tag silently zeroes a live run, or lets a stale tracker double count a folded one.
function expectTaggedWithCurrentRun(
  manager: { liveRunStats?(taskId: string): { readonly runStartEpoch: number } | undefined },
  record: TaskRecord | null | undefined,
): void {
  if (record === null || record === undefined) throw new Error("record vanished")
  expect(manager.liveRunStats?.(record.task_id)?.runStartEpoch).toBe(record.run_start_epoch ?? LEGACY_RUN_START_EPOCH)
}

describe("every run-stats tracker is tagged with the run it measures", () => {
  test("#given a spawned child #when its first run is live #then the tracker names run_start_epoch 0", async () => {
    // given
    const { manager, store } = makeManager()

    // when
    const started = await manager.start(baseSpec())
    if (started.kind !== "started") throw new Error("expected started")

    // then
    expectTaggedWithCurrentRun(manager, store.load(started.task_id))
  })

  test("#given a completed resident child #when task_send revives it #then the new tracker names the revived run", async () => {
    // given
    const { manager, store, inProcess } = makeManager()
    const started = await manager.start(baseSpec())
    if (started.kind !== "started") throw new Error("expected started")
    inProcess.handles.get(started.task_id)?.settle({ status: "completed", finalResponse: "first" })
    await manager.waitFor(started.task_id)

    // when
    const send = await manager.sendToTask({ idOrName: started.task_id, message: "again" })
    if (send.kind !== "revived") throw new Error(`expected revived, got ${send.kind}`)

    // then
    const record = store.load(started.task_id)
    expect(record?.run_start_epoch).toBe(1)
    expectTaggedWithCurrentRun(manager, record)
  })

  test("#given a completed resident child #when it resumes on its own #then the tracker names the resumed run", async () => {
    // given
    const processRunner = new FakeRunner()
    const { manager, store } = makeManager({ process: processRunner })
    const started = await manager.start(baseSpec({ execution_mode: "process" }))
    if (started.kind !== "started") throw new Error("expected started")
    const fake = processRunner.handles.get(started.task_id)
    if (fake === undefined) throw new Error("no handle")
    fake.settle({ status: "completed", finalResponse: "waiting" })
    await flush()

    // when: the resume listener installs its tracker synchronously, before the reopen commits the run
    fake.selfResume()
    const beforeReopen = manager.liveRunStats?.(started.task_id)?.runStartEpoch
    await flush()

    // then: both the pre-reopen tracker and the committed one name the resumed run
    const record = store.load(started.task_id)
    expect(record?.run_start_epoch).toBe(1)
    expect(beforeReopen).toBe(1)
    expectTaggedWithCurrentRun(manager, record)
  })

  test("#given a persisted-only child #when a send revives it cold #then the tracker names the revived run", async () => {
    // given
    const h = coldReviveHarness()
    try {
      // when
      expect((await h.send()).kind).toBe("revived")

      // then
      const record = h.store.load(h.record.task_id)
      expect(record?.run_start_epoch).toBe(1)
      expectTaggedWithCurrentRun(h.manager, record)
    } finally {
      await h.dispose()
    }
  })

  test("#given a keep_alive worker that finished an item #when the pool reuses it #then the tracker names the reused run", async () => {
    // given
    const f = fixture()
    const pool = f.manager.workpools.create(f.caller, { ...poolInput, mode: "keep_alive" })
    const first = f.manager.workpools.waitForEvent(pool.pool_id, "dispatched", AbortSignal.timeout(5000))
    f.manager.workpools.push(f.caller, pool.pool_id, [{ key: "a", input: 1 }])
    const dispatched = await bounded(first)
    const taskId = dispatched.task_id
    if (taskId === undefined) throw new Error("no worker")
    f.manager.workpools.yieldResults(taskId, dispatched.run_epoch ?? 0, { op: "yield", results: [{ key: "a", data: 1 }] })
    f.handles.get(taskId)?.settle({ status: "completed", finalResponse: "a done" })
    await f.manager.waitFor(taskId)

    // when
    const second = f.manager.workpools.waitForEvent(pool.pool_id, "dispatched", AbortSignal.timeout(5000))
    f.manager.workpools.push(f.caller, pool.pool_id, [{ key: "b", input: 2 }])
    const reused = await bounded(second)

    // then
    expect(reused.task_id).toBe(taskId)
    const record = f.store.load(taskId)
    expect(record?.run_start_epoch).toBe(1)
    expectTaggedWithCurrentRun(f.manager, record)
  })
})
