import { afterEach, describe, expect, test } from "bun:test"

import { baseSpec, cleanupProjects } from "./__fixtures__/manager-fakes"
import { RACE_PARTIAL_TEXT, makeRaceHarness, type RaceFlavor } from "./__fixtures__/race-fakes"

afterEach(cleanupProjects)

const flavors: RaceFlavor[] = ["in-process", "rpc"]

describe.each(flavors)("steering single-writer over the %s launch-outcome tracker", (flavor) => {
  test("#given the launch tracker settles on abort #when interrupted #then the record stays interrupted with partial text", async () => {
    // given
    const { manager, store } = makeRaceHarness(flavor)
    const started = await manager.start(baseSpec())
    if (started.kind !== "started") throw new Error("expected started")

    // when
    const outcome = await manager.interruptTask(started.task_id)

    // then
    if (outcome.kind !== "interrupted") throw new Error(`expected interrupted, got ${outcome.kind}`)
    const record = store.load(started.task_id)
    expect(record?.status).toBe("interrupted")
    expect(record?.final_response).toBe(RACE_PARTIAL_TEXT)
  })

  test("#given the launch tracker settles on abort #when cancelled #then the record is cancelled and destruction runs exactly once", async () => {
    // given
    const { manager, store, destruction } = makeRaceHarness(flavor)
    const started = await manager.start(baseSpec())
    if (started.kind !== "started") throw new Error("expected started")

    // when
    const outcome = await manager.cancelTask(started.task_id, "user aborted")

    // then
    if (outcome.kind !== "cancelled") throw new Error(`expected cancelled, got ${outcome.kind}`)
    expect(store.load(started.task_id)?.status).toBe("cancelled")
    expect(destruction.calls).toEqual([{ taskId: started.task_id, cause: "cancel" }])
  })

  test("#given an already-cancelled task #when cancelled again #then it is a no-op and destruction is not re-run", async () => {
    // given
    const { manager, destruction } = makeRaceHarness(flavor)
    const started = await manager.start(baseSpec())
    if (started.kind !== "started") throw new Error("expected started")
    await manager.cancelTask(started.task_id)

    // when
    const second = await manager.cancelTask(started.task_id)

    // then
    expect(second.kind).toBe("noop")
    expect(destruction.calls).toHaveLength(1)
  })

  test("#given an already-interrupted task #when interrupted again #then it is an idempotent no-op", async () => {
    // given
    const { manager } = makeRaceHarness(flavor)
    const started = await manager.start(baseSpec())
    if (started.kind !== "started") throw new Error("expected started")
    await manager.interruptTask(started.task_id)

    // when
    const second = await manager.interruptTask(started.task_id)

    // then
    expect(second.kind).toBe("noop")
  })
})
