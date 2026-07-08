import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import { FakeRunner, baseSpec, cleanupProjects, categoryPlanner, flush, makeManager, settings } from "./__fixtures__/manager-fakes"

afterEach(cleanupProjects)

describe("TaskManager.start", () => {
  test("#given a valid spec #when started #then it returns a st_ id and running status with a persisted record", async () => {
    // given
    const { manager, store } = makeManager({})

    // when
    const result = await manager.start(baseSpec())

    // then
    expect(result.kind).toBe("started")
    if (result.kind !== "started") throw new Error("expected started")
    expect(result.task_id).toMatch(/^st_[0-9a-f]{8}$/)
    expect(result.status).toBe("running")
    expect(store.load(result.task_id)?.status).toBe("running")
  })

  test("#given a child beyond max depth without allowance #when started #then DepthDenied is returned and zero records exist", async () => {
    // given
    const { manager, store } = makeManager({ config: settings({ max_depth: 1 }) })

    // when
    const result = await manager.start(baseSpec({ depth: 2 }))

    // then
    expect(result.kind).toBe("depth_denied")
    expect(store.list().records).toHaveLength(0)
  })

  test("#given a full model slot #when a further same-model task starts #then it queues FIFO and starts when a slot frees", async () => {
    // given
    const { manager, store, inProcess } = makeManager({ config: settings({ default_concurrency: 1, max_depth: 1 }) })
    const first = await manager.start(baseSpec({ name: "a" }))
    if (first.kind !== "started") throw new Error("expected started")

    // when
    const second = await manager.start(baseSpec({ name: "b" }))
    if (second.kind !== "started") throw new Error("expected started")

    // then
    expect(second.status).toBe("pending")
    expect(second.queue_position).toBe(1)

    // when the first frees its slot
    inProcess.handles.get(first.task_id)?.settle({ status: "completed", finalResponse: "ok" })
    await flush()

    // then the queued task is now running
    expect(store.load(second.task_id)?.status).toBe("running")
    expect(store.load(first.task_id)?.status).toBe("completed")
  })

  test("#given two categories that resolve to different models #when both start under a shared limit of 1 #then both run", async () => {
    // given
    const planner = categoryPlanner({ quick: "anthropic/claude", deep: "openai/gpt" })
    const { manager, store } = makeManager({ planner, config: settings({ default_concurrency: 1, max_depth: 1 }) })

    // when
    const a = await manager.start(baseSpec({ category: "quick", name: "a" }))
    const b = await manager.start(baseSpec({ category: "deep", name: "b" }))

    // then
    if (a.kind !== "started" || b.kind !== "started") throw new Error("expected started")
    expect(a.status).toBe("running")
    expect(b.status).toBe("running")
    expect(store.load(a.task_id)?.status).toBe("running")
    expect(store.load(b.task_id)?.status).toBe("running")
  })

  test("#given a runner whose start throws #when a task starts #then the slot is released, the record is error, and a failure event is logged", async () => {
    // given
    const throwingRunner = new FakeRunner()
    throwingRunner.throwOnStart = true
    const { manager, store, project } = makeManager({
      inProcess: throwingRunner,
      config: settings({ default_concurrency: 1, max_depth: 1 }),
    })

    // when
    const result = await manager.start(baseSpec())

    // then
    expect(result.kind).toBe("start_failed")
    if (result.kind !== "start_failed") throw new Error("expected start_failed")
    expect(store.load(result.task_id)?.status).toBe("error")
    const jsonl = readFileSync(join(project, ".omo", "senpi-task", "logs", `${result.task_id}.jsonl`), "utf8")
    expect(jsonl).toContain("error")

    // and the slot drained: a healthy runner can now start
    throwingRunner.throwOnStart = false
    const next = await manager.start(baseSpec())
    expect(next.kind).toBe("started")
    if (next.kind !== "started") throw new Error("expected started")
    expect(next.status).toBe("running")
  })

  test("#given a requested name that collides in the same parent #when started #then a -2 suffix and a warning are returned", async () => {
    // given
    const { manager } = makeManager({})
    await manager.start(baseSpec({ name: "reviewer" }))

    // when
    const second = await manager.start(baseSpec({ name: "reviewer" }))

    // then
    if (second.kind !== "started") throw new Error("expected started")
    expect(second.name).toBe("reviewer-2")
    expect(second.name_warning).toBeDefined()
  })

  test("#given execution_mode process on the spec #when started #then the process runner is used", async () => {
    // given
    const inProcess = new FakeRunner()
    const processRunner = new FakeRunner()
    const { manager } = makeManager({ inProcess, process: processRunner })

    // when
    await manager.start(baseSpec({ execution_mode: "process" }))

    // then
    expect(processRunner.startedSpecs).toHaveLength(1)
    expect(inProcess.startedSpecs).toHaveLength(0)
  })
})
