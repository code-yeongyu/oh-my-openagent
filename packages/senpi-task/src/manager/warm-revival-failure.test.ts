import { afterEach, describe, expect, spyOn, test } from "bun:test"

import { FakeRunner, baseSpec, cleanupProjects, makeManager } from "./__fixtures__/manager-fakes"

afterEach(cleanupProjects)

// A resident child that already finished refused the revival prompt (the engine was compacting).
// The send reported not_continuable but left the record on a new running epoch with no outcome
// tracker and no slot: the next send went in as a plain steer, the child ran to completion, and
// nothing ever settled the record, so the parent waited on a "starting" child for days.
describe("warm revival whose prompt the live child refuses", () => {
  test("#given a completed resident child #when its revival prompt is refused #then the record is restored to its terminal run and the next send revives and settles normally", async () => {
    // given
    const inProcess = new FakeRunner()
    const { manager, store } = makeManager({ inProcess })
    const started = await manager.start(baseSpec({ run_in_background: true }))
    if (started.kind !== "started") throw new Error("expected started")
    const fake = inProcess.handles.get(started.task_id)
    if (fake === undefined) throw new Error("missing child handle")
    const first = manager.waitFor(started.task_id, { signal: AbortSignal.timeout(5000) })
    fake.settle({ status: "completed", finalResponse: "first" })
    await first
    const refusal = spyOn(fake.handle, "followUp").mockImplementationOnce(() =>
      Promise.reject(new Error("Cannot submit a prompt while compaction is in progress. Wait for compaction to finish and retry.")))

    // when
    const refused = await manager.sendToTask({ idOrName: started.task_id, message: "continue" })

    // then
    expect(refused.kind).toBe("not_continuable")
    expect(refusal).toHaveBeenCalledTimes(1)
    expect(store.load(started.task_id)).toMatchObject({
      status: "completed",
      final_response: "first",
      notification: { run_epoch: 0 },
    })

    // when
    const retried = await manager.sendToTask({ idOrName: started.task_id, message: "continue" })

    // then
    expect(retried).toMatchObject({ kind: "revived", run_epoch: 1 })
    const second = manager.waitFor(started.task_id, { signal: AbortSignal.timeout(5000) })
    fake.settle({ status: "completed", finalResponse: "second" })
    expect(await second).toMatchObject({ status: "completed", final_response: "second" })
  })
})
