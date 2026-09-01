import { afterEach, describe, expect, test } from "bun:test"

import { createTaskRecordStore } from "../store"
import type { TaskRecordStore } from "../store"
import { createTaskManager } from "./manager"
import type { ChildPlanner, ResolvedChildPlan } from "./types"
import {
  FakeRunner,
  baseSpec,
  categoryPlanner,
  cleanupProjects,
  makeManager,
  settings,
  tempProject,
} from "./__fixtures__/manager-fakes"

const primary = "vendor-a/primary"
const next = "vendor-b/next"
const later = "vendor-c/later"

function fallbackPlan(): ResolvedChildPlan {
  return {
    model: primary,
    requested_model: { source: "category", provider: "vendor-a", model_id: "primary", display: primary },
    resolved_model: { source: "category", provider: "vendor-a", model_id: "primary", display: primary },
    fallback_models: [
      { source: "category", provider: "vendor-b", model_id: "next", display: next },
      { source: "category", provider: "vendor-c", model_id: "later", display: later },
    ],
  }
}

function planner(plan: ResolvedChildPlan): ChildPlanner {
  return () => ({ kind: "resolved", plan })
}

async function failForFallback(handle: ReturnType<FakeRunner["handles"]["get"]>): Promise<void> {
  if (handle === undefined) throw new Error("expected handle")
  const unsubscribed = handle.waitForUnsubscription()
  handle.settle({ status: "error", failure: { kind: "child-turn-failed", message: "provider failed" } })
  await unsubscribed
}

function managerWithStore(store: TaskRecordStore, runner: FakeRunner) {
  return createTaskManager({
    store,
    runners: { "in-process": runner, process: new FakeRunner() },
    planner: categoryPlanner(),
    config: settings({ default_concurrency: 1, max_depth: 1 }),
    cwd: tempProject(),
  })
}

afterEach(cleanupProjects)

describe("TaskManager capacity paths", () => {
  test("#given runtime fallback capacity #when the primary fails #then its old lease is released and only the next rung launches", async () => {
    const runner = new FakeRunner()
    const plans = new Map<string, ResolvedChildPlan>([
      ["holder", { model: next }],
      ["fallback", fallbackPlan()],
    ])
    const { manager, store } = makeManager({
      inProcess: runner,
      planner: (spec) => ({ kind: "resolved", plan: plans.get(spec.name ?? "") ?? { model: primary } }),
      config: settings({ default_concurrency: 1, global_concurrency: 2, max_depth: 1 }),
    })
    const holder = await manager.start(baseSpec({ name: "holder" }))
    const task = await manager.start(baseSpec({ name: "fallback" }))
    if (holder.kind !== "started" || task.kind !== "started") throw new Error("expected tasks")

    await failForFallback(runner.handles.get(task.task_id))

    expect(store.load(task.task_id)).toMatchObject({ model: next, fallback_models: [{ display: later }] })
    expect(runner.startedSpecs.map((spec) => spec.model)).toEqual([next, primary])
    const other = await manager.start(baseSpec({ name: "other", model: primary }))
    expect(other).toMatchObject({ kind: "started", status: "running" })
    await manager.cancelTask(holder.task_id)
    expect(runner.startedSpecs.filter((spec) => spec.taskId === task.task_id).map((spec) => spec.model)).toEqual([primary, next])
  })

  test("#given a runtime fallback waiter #when it is cancelled before capacity frees #then it never launches later", async () => {
    const runner = new FakeRunner()
    const plans = new Map<string, ResolvedChildPlan>([
      ["holder", { model: next }],
      ["fallback", fallbackPlan()],
      ["probe", { model: next }],
    ])
    const { manager } = makeManager({
      inProcess: runner,
      planner: (spec) => ({ kind: "resolved", plan: plans.get(spec.name ?? "") ?? { model: primary } }),
      config: settings({ default_concurrency: 1, global_concurrency: 2, max_depth: 1 }),
    })
    const holder = await manager.start(baseSpec({ name: "holder" }))
    const task = await manager.start(baseSpec({ name: "fallback" }))
    if (holder.kind !== "started" || task.kind !== "started") throw new Error("expected tasks")
    await failForFallback(runner.handles.get(task.task_id))

    expect(runner.startedSpecs.map((spec) => spec.model)).toEqual([next, primary])
    expect((await manager.cancelTask(task.task_id)).kind).toBe("cancelled")
    const probe = await manager.start(baseSpec({ name: "probe", model: next }))
    expect(probe).toMatchObject({ kind: "started", status: "pending", queue_position: 1 })
    expect((await manager.cancelTask(holder.task_id)).kind).toBe("cancelled")

    if (probe.kind !== "started") throw new Error("expected probe")
    expect(manager.get(probe.task_id)?.status).toBe("running")
    expect(runner.startedSpecs.filter((spec) => spec.taskId === task.task_id)).toHaveLength(1)
  })

  test("#given an old primary waiter #when fallback capacity frees #then a new spawn spills around it and primary release grants it first", async () => {
    const runner = new FakeRunner()
    const { manager, store } = makeManager({
      inProcess: runner,
      planner: planner({ ...fallbackPlan(), fallback_models: fallbackPlan().fallback_models?.slice(0, 1) }),
      config: settings({ default_concurrency: 1, global_concurrency: 3, max_depth: 1 }),
    })
    const primaryHolder = await manager.start(baseSpec({ name: "primary-holder", model: primary }))
    const fallbackHolder = await manager.start(baseSpec({ name: "fallback-holder", model: next }))
    const oldWaiter = await manager.start(baseSpec({ name: "old-waiter" }))
    if (primaryHolder.kind !== "started" || fallbackHolder.kind !== "started" || oldWaiter.kind !== "started") throw new Error("expected tasks")
    expect(oldWaiter.status).toBe("pending")

    await manager.cancelTask(fallbackHolder.task_id)
    expect(store.load(oldWaiter.task_id)?.status).toBe("pending")
    const newcomer = await manager.start(baseSpec({ name: "newcomer" }))
    expect(newcomer).toMatchObject({ kind: "started", status: "running" })
    if (newcomer.kind !== "started") throw new Error("expected newcomer")
    expect(store.load(newcomer.task_id)?.model).toBe(next)

    await manager.cancelTask(primaryHolder.task_id)
    expect(store.load(oldWaiter.task_id)?.status).toBe("running")
    const laterAdmission = await manager.start(baseSpec({ name: "later-admission" }))
    expect(laterAdmission).toMatchObject({ kind: "started", status: "pending", queue_position: 1 })
    await manager.cancelTask(oldWaiter.task_id)
    if (laterAdmission.kind !== "started") throw new Error("expected later admission")
    expect(store.load(laterAdmission.task_id)?.status).toBe("running")
  })

  test("#given a released terminal task #when revived and completed #then it acquires once and releases once", async () => {
    const runner = new FakeRunner()
    const { manager, store } = makeManager({
      inProcess: runner,
      config: settings({ default_concurrency: 1, global_concurrency: 1, max_depth: 1 }),
    })
    const task = await manager.start(baseSpec({ name: "revive" }))
    if (task.kind !== "started") throw new Error("expected task")
    const handle = runner.handles.get(task.task_id)
    handle?.settle({ status: "completed", finalResponse: "first" })
    expect((await manager.waitFor(task.task_id)).status).toBe("completed")

    expect((await manager.continueTask(task.task_id, "again")).kind).toBe("continued")
    const blocked = await manager.start(baseSpec({ name: "blocked" }))
    expect(blocked).toMatchObject({ kind: "started", status: "pending" })
    handle?.settle({ status: "completed", finalResponse: "second" })
    expect((await manager.waitFor(task.task_id)).status).toBe("completed")

    expect(store.load(blocked.kind === "started" ? blocked.task_id : "")?.status).toBe("running")
    expect(handle?.followUpCalls).toEqual(["again"])
  })

  test("#given persistence fails after acquire #when spawning #then the lease is released and no child starts", async () => {
    const inner = createTaskRecordStore({ project_dir: tempProject() })
    let failReplace = true
    const store: TaskRecordStore = {
      ...inner,
      replace(record) {
        if (failReplace) {
          failReplace = false
          throw new Error("injected persistence failure")
        }
        inner.replace(record)
      },
    }
    const runner = new FakeRunner()
    const manager = managerWithStore(store, runner)

    const failed = await manager.start(baseSpec({ name: "failed" }))
    const nextTask = await manager.start(baseSpec({ name: "next" }))

    expect(failed).toMatchObject({ kind: "start_failed", error_message: "spawn bookkeeping failed" })
    expect(nextTask).toMatchObject({ kind: "started", status: "running" })
    expect(runner.startedSpecs).toHaveLength(1)
  })
})
