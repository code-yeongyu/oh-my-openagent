import { resolve } from "node:path"

import { afterEach, describe, expect, test } from "bun:test"

import { FakeRunner, baseSpec, cleanupProjects, flush, makeManager } from "./__fixtures__/manager-fakes"

const seedFloorChildFixturePath = resolve(import.meta.dir, "__fixtures__", "seed-floor-child.ts")

async function expectSeedFloorChildModeToSucceed(mode: string): Promise<void> {
  const child = Bun.spawn([process.execPath, seedFloorChildFixturePath, mode], { stdout: "pipe", stderr: "pipe" })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])

  expect(exitCode, `stdout:\n${stdout}\nstderr:\n${stderr}`).toBe(0)
}

afterEach(cleanupProjects)

describe("TaskManager claim characterization", () => {
  test("#given no requested name #when started #then the fallback name is the task id", async () => {
    // given
    const { manager } = makeManager()

    // when
    const result = await manager.start(baseSpec())

    // then
    if (result.kind !== "started") throw new Error("expected started")
    expect(result.name).toMatch(/^st_[0-9a-f]{8}$/)
    expect(result.name).toBe(result.task_id)
  })

  test("#given a duplicate requested name in one parent #when started #then it receives a suffix and warning", async () => {
    // given
    const { manager } = makeManager()
    await manager.start(baseSpec({ name: "reviewer" }))

    // when
    const result = await manager.start(baseSpec({ name: "reviewer" }))

    // then
    if (result.kind !== "started") throw new Error("expected started")
    expect(result.name).toBe("reviewer-2")
    expect(result.name_warning).toBeDefined()
  })

  test("#given a background spec #when started #then the manager tracks its task as background", async () => {
    // given
    const { manager } = makeManager()

    // when
    const result = await manager.start(baseSpec({ run_in_background: true }))

    // then
    if (result.kind !== "started") throw new Error("expected started")
    expect(manager.wasBackground(result.task_id)).toBe(true)
  })

  test("#given a runner that fails after persistence #when started and its name is requested again #then the record is terminal and the name remains reserved", async () => {
    // given
    const inProcess = new FakeRunner()
    inProcess.throwOnStart = true
    const { manager, store } = makeManager({ inProcess })

    // when
    const failed = await manager.start(baseSpec({ name: "durable-name" }))
    await flush()
    inProcess.throwOnStart = false
    const retried = await manager.start(baseSpec({ name: "durable-name" }))

    // then
    expect(failed.kind).toBe("start_failed")
    if (failed.kind !== "start_failed") throw new Error("expected start_failed")
    expect(store.load(failed.task_id)?.status).toBe("error")
    if (retried.kind !== "started") throw new Error("expected started")
    expect(retried.name).toBe("durable-name-2")
    expect(retried.name_warning).toBeDefined()
  })

  test("#given process execution mode #when started #then its record persists a spawn spec", async () => {
    // given
    const { manager, store } = makeManager()

    // when
    const result = await manager.start(baseSpec({ execution_mode: "process" }))

    // then
    if (result.kind !== "started") throw new Error("expected started")
    expect(store.load(result.task_id)?.spawn_spec).toBeDefined()
  })

  test.each(["", "   "])("#given a blank requested name %p #when started #then it falls back to the task id", async (name) => {
    // given
    const { manager } = makeManager()

    // when
    const result = await manager.start(baseSpec({ name }))

    // then
    if (result.kind !== "started") throw new Error("expected started")
    expect(result.name).toMatch(/^st_[0-9a-f]{8}$/)
    expect(result.name).toBe(result.task_id)
  })

  test.each(["seed", "warm-cache", "diagnostics"])(
    "#given an isolated manager process #when %s seeds from disk #then it succeeds",
    async (mode) => {
      await expectSeedFloorChildModeToSucceed(mode)
    },
  )
})
