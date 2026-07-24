import { afterEach, describe, expect, test } from "bun:test"

import { FakeRunner, baseSpec, cleanupProjects, flush, makeManager, settings } from "./__fixtures__/manager-fakes"

afterEach(cleanupProjects)

describe("TaskManager.continueTask", () => {
  test("#given a running resident child #when continued with steer #then the steer is delivered via the handle", async () => {
    // given
    const inProcess = new FakeRunner()
    const { manager } = makeManager({ inProcess })
    const started = await manager.start(baseSpec())
    if (started.kind !== "started") throw new Error("expected started")

    // when
    const result = await manager.continueTask(started.task_id, "keep going", "parent-1", "steer")

    // then
    expect(result.kind).toBe("continued")
    if (result.kind !== "continued") throw new Error("expected continued")
    expect(result.delivered).toBe("steer")
    expect(inProcess.handles.get(started.task_id)?.steerCalls).toEqual(["keep going"])
  })

  test("#given a running resident child #when continued with no deliver_as #then followUp is the default", async () => {
    // given
    const inProcess = new FakeRunner()
    const { manager } = makeManager({ inProcess })
    const started = await manager.start(baseSpec())
    if (started.kind !== "started") throw new Error("expected started")

    // when
    const result = await manager.continueTask(started.task_id, "more context", "parent-1")

    // then
    if (result.kind !== "continued") throw new Error("expected continued")
    expect(result.delivered).toBe("followUp")
    expect(inProcess.handles.get(started.task_id)?.followUpCalls).toEqual(["more context"])
  })

  test("#given a completed but resident child #when continued #then it is revived on the same handle with an incremented epoch", async () => {
    // given
    const inProcess = new FakeRunner()
    const { manager, store } = makeManager({ inProcess })
    const started = await manager.start(baseSpec())
    if (started.kind !== "started") throw new Error("expected started")
    inProcess.handles.get(started.task_id)?.settle({ status: "completed", finalResponse: "first pass" })
    await flush()
    expect(store.load(started.task_id)?.status).toBe("completed")

    // when
    const result = await manager.continueTask(started.task_id, "second pass", "parent-1")

    // then
    if (result.kind !== "continued") throw new Error("expected continued")
    expect(result.delivered).toBe("revive")
    expect(inProcess.handles.get(started.task_id)?.followUpCalls).toEqual(["second pass"])
    const record = store.load(started.task_id)
    expect(record?.status).toBe("running")
    expect(record?.notification.run_epoch).toBe(1)
  })

  test("#given a cancelled child #when continued #then it is not continuable and suggests task_output", async () => {
    // given
    const { manager, store } = makeManager({})
    const started = await manager.start(baseSpec())
    if (started.kind !== "started") throw new Error("expected started")
    store.transition(started.task_id, { type: "cancel", timestamp: new Date().toISOString() })

    // when
    const result = await manager.continueTask(started.task_id, "hello", "parent-1")

    // then
    expect(result.kind).toBe("not_continuable")
    if (result.kind !== "not_continuable") throw new Error("expected not_continuable")
    expect(result.suggestion).toContain("task_output")
  })

  test("#given an unknown task id #when continued #then it is not continuable", async () => {
    // given
    const { manager } = makeManager({})

    // when
    const result = await manager.continueTask("st_0000dead", "hello", "parent-1")

    // then
    expect(result.kind).toBe("not_continuable")
  })
})

describe("TaskManager.list and get", () => {
  test("#given tasks across two parents #when listing a parent scope #then only that parent's tasks appear", async () => {
    // given
    const { manager } = makeManager({})
    const mine = await manager.start(baseSpec({ parent_session_id: "parent-1", name: "mine" }))
    await manager.start(baseSpec({ parent_session_id: "parent-2", name: "theirs" }))
    if (mine.kind !== "started") throw new Error("expected started")

    // when
    const listed = manager.list({ scope: "parent-session", session_id: "parent-1" })

    // then
    expect(listed).toHaveLength(1)
    expect(listed[0]?.record.task_id).toBe(mine.task_id)
  })

  test("#given a queued task #when listing #then its queue position is exposed", async () => {
    // given
    const { manager } = makeManager({ config: settings({ default_concurrency: 1, max_depth: 1 }) })
    await manager.start(baseSpec({ name: "a" }))
    const queued = await manager.start(baseSpec({ name: "b" }))
    if (queued.kind !== "started") throw new Error("expected started")

    // when
    const listed = manager.list({ scope: "all" })
    const queuedEntry = listed.find((entry) => entry.record.task_id === queued.task_id)

    // then
    expect(queuedEntry?.queue_position).toBe(1)
  })

  test("#given a foreground task #when waiting for it #then waitFor resolves with the terminal record", async () => {
    // given
    const { manager, inProcess } = makeManager({})
    const started = await manager.start(baseSpec())
    if (started.kind !== "started") throw new Error("expected started")

    // when
    inProcess.handles.get(started.task_id)?.settle({ status: "completed", finalResponse: "the answer" })
    const record = await manager.waitFor(started.task_id)

    // then
    expect(record.status).toBe("completed")
    expect(record.final_response).toBe("the answer")
  })
})
