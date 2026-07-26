import { resolve } from "node:path"

import { afterEach, describe, expect, test } from "bun:test"

import { normalizeSenpiTeamSpec, spawnTeamMembers } from "../team"
import { bumpTaskId } from "../state"
import type { TaskRecord, TaskTransition, TaskTransitionResult } from "../state"
import { TaskRecordCollisionError, createTaskRecordStore } from "../store"
import type { PersistedTaskEvent, TaskRecordStore } from "../store"
import { collisionStore } from "./__fixtures__/collision-store"
import { FakeRunner, baseSpec, categoryPlanner, cleanupProjects, flush, makeManager, settings, tempProject } from "./__fixtures__/manager-fakes"
import { createTaskManager } from "./manager"

function firstAllocationFailsStore(inner: TaskRecordStore): TaskRecordStore {
  let armed = true
  return {
    ...inner,
    save(record) {
      if (armed) {
        armed = false
        throw new TaskRecordCollisionError({ taskId: "st_ffffffff", path: "injected" })
      }
      inner.save(record)
    },
  }
}

function replaceFailsOnceStore(
  inner: TaskRecordStore,
  transitions: TaskTransition[],
): { readonly store: TaskRecordStore; readonly applied: () => readonly boolean[] } {
  let failReplace = true
  const applied: boolean[] = []
  return {
    store: {
      ...inner,
      replace(record) {
        if (failReplace) {
          failReplace = false
          throw new Error("injected bookkeeping failure")
        }
        inner.replace(record)
      },
      transition(taskId, transition): TaskTransitionResult {
        transitions.push(transition)
        const result = inner.transition(taskId, transition)
        applied.push(result.applied)
        return result
      },
    },
    applied: () => applied,
  }
}

function managerWithStore(
  store: TaskRecordStore,
  inProcess = new FakeRunner(),
  process = new FakeRunner(),
  now?: () => number,
) {
  const project = tempProject()
  const manager = createTaskManager({
    store,
    runners: { "in-process": inProcess, process },
    planner: categoryPlanner(),
    config: settings({ default_concurrency: 5, max_depth: 1 }),
    cwd: project,
    ...(now === undefined ? {} : { now }),
  })
  return { manager, inProcess, process }
}

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

  test("#given an id-shaped requested name #when an unnamed task claims its fallback #then every saved sibling name is unique", async () => {
    // given
    const project = tempProject()
    const inner = createTaskRecordStore({ project_dir: project })
    const invariantStore: TaskRecordStore = {
      ...inner,
      save(record) {
        for (const sibling of inner.list().records) {
          if (sibling.parent_session_id === record.parent_session_id && sibling.name === record.name) {
            throw new Error(`duplicate task name persisted: ${record.name}`)
          }
        }
        inner.save(record)
      },
    }
    const clock = () => (Math.floor(Date.now() / 65_536) + 1_000_000) * 65_536
    const firstTaskId = `st_${Math.floor(clock() / 65_536).toString(16).padStart(8, "0")}`
    const { manager } = managerWithStore(invariantStore, new FakeRunner(), new FakeRunner(), clock)

    // when
    const first = await manager.start(baseSpec({ name: bumpTaskId(firstTaskId as `st_${string}`) }))
    const second = await manager.start(baseSpec())

    // then
    if (first.kind !== "started" || second.kind !== "started") throw new Error("expected both tasks to start")
    expect(first.task_id).toBe(firstTaskId)
    expect(first.name).toBe(bumpTaskId(firstTaskId as `st_${string}`))
    expect(second.task_id).toBe(bumpTaskId(first.name as `st_${string}`))
    expect(second.name).toBe(second.task_id)
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

  test("#given a foreign winner for the first candidate #when started #then it claims the next id", async () => {
    // given
    const project = tempProject()
    const inner = createTaskRecordStore({ project_dir: project })
    const collision = collisionStore(inner)
    const { manager } = managerWithStore(collision.store)

    // when
    const result = await manager.start(baseSpec())

    // then
    if (result.kind !== "started") throw new Error("expected started")
    expect(result.task_id).toBe(bumpTaskId(collision.firstCandidate() as `st_${string}`))
    expect(result.name).toBe(result.task_id)
    expect(inner.load(collision.firstCandidate() as string)?.name).toBe("foreign-winner")
    expect(inner.load(result.task_id)?.name).toBe(result.task_id)
  })

  test("#given a requested name and a foreign winner #when started #then only the loser keeps the requested name", async () => {
    // given
    const project = tempProject()
    const inner = createTaskRecordStore({ project_dir: project })
    const collision = collisionStore(inner)
    const { manager } = managerWithStore(collision.store)

    // when
    const result = await manager.start(baseSpec({ name: "todo11" }))

    // then
    if (result.kind !== "started") throw new Error("expected started")
    const records = inner.list().records.filter((record) => record.parent_session_id === "parent-1")
    expect(inner.load(collision.firstCandidate() as string)?.name).toBe("foreign-winner")
    expect(result.name).toBe("todo11")
    expect(records.filter((record) => record.name === "todo11")).toHaveLength(1)
    expect(new Set(records.map((record) => record.name)).size).toBe(records.length)
  })

  test("#given a real manager under collision #when team members spawn #then no member start is rejected", async () => {
    // given
    const project = tempProject()
    const inner = createTaskRecordStore({ project_dir: project })
    const collision = collisionStore(inner)
    const { manager } = managerWithStore(collision.store)
    const spec = normalizeSenpiTeamSpec(
      { members: [{ name: "alpha", kind: "category", category: "quick", prompt: "work" }] },
      "collision-team",
    )

    // when
    const result = await spawnTeamMembers({
      spec,
      teamRunId: "collision-run",
      manager,
      leadSessionId: "parent-1",
      spawnDepth: 1,
      maxParallel: 1,
      deadlineAt: 1_000,
      now: () => 0,
    })

    // then
    if (result.failure !== undefined) expect(result.failure.message).not.toContain("member_start_rejected")
    expect(result.failure).toBeUndefined()
    expect(result.spawned.size).toBe(1)
  })

  test("#given an allocation failure #when the requested name is retried #then its reservation was released", async () => {
    // given
    const project = tempProject()
    const inner = createTaskRecordStore({ project_dir: project })
    const { manager } = managerWithStore(firstAllocationFailsStore(inner))

    // when
    const failed = await manager.start(baseSpec({ name: "todo11" }))
    const retried = await manager.start(baseSpec({ name: "todo11" }))

    // then
    expect(failed.kind).toBe("start_failed")
    if (failed.kind !== "start_failed") throw new Error("expected start_failed")
    expect(failed.task_id).toBe("")
    expect(failed.error_message).toContain("allocation failed")
    expect(failed.error_message).not.toContain("already exists")
    if (retried.kind !== "started") throw new Error("expected started")
    expect(retried.name).toBe("todo11")
  })

  test("#given bookkeeping fails after a claim #when process mode starts #then it records a terminal failure", async () => {
    // given
    const project = tempProject()
    const inner = createTaskRecordStore({ project_dir: project })
    const transitions: TaskTransition[] = []
    const bookkeeping = replaceFailsOnceStore(inner, transitions)
    const { manager } = managerWithStore(bookkeeping.store)

    // when
    const result = await manager.start(baseSpec({ execution_mode: "process", run_in_background: true }))

    // then
    expect(result.kind).toBe("start_failed")
    if (result.kind !== "start_failed") throw new Error("expected start_failed")
    expect(result.task_id).toMatch(/^st_[0-9a-f]{8}$/)
    expect(inner.load(result.task_id)?.status).toBe("error")
    expect(inner.load(result.task_id)?.error_message).toBe("spawn bookkeeping failed")
    expect(transitions.map((transition) => transition.type)).toEqual(["start", "fail"])
    expect(bookkeeping.applied()).toEqual([true, true])
    expect(manager.wasBackground(result.task_id)).toBe(false)
  })

  test("#given a whitespace requested name #when a collision is claimed #then the fallback follows the final id", async () => {
    // given
    const project = tempProject()
    const inner = createTaskRecordStore({ project_dir: project })
    const collision = collisionStore(inner)
    const { manager } = managerWithStore(collision.store)

    // when
    const result = await manager.start(baseSpec({ name: "  " }))

    // then
    if (result.kind !== "started") throw new Error("expected started")
    expect(result.name).toBe(result.task_id)
    expect(result.name).not.toBe("task-1")
  })
})
