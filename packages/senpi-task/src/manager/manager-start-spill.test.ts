import { afterEach, describe, expect, test } from "bun:test"
import { join } from "node:path"

import { awaitWithinTestBudget } from "../../../../test-support/test-deadline"
import { createTaskRecordStore } from "../store"
import { ownedTaskState } from "../store/__fixtures__/owned-task-state"
import { withTaskRecordLockAsync } from "../store/record-lock"
import { baseSpec, cleanupProjects, flush, makeManager, settings, tempProject } from "./__fixtures__/manager-fakes"
import type { ResolvedChildPlan } from "./types"

const primary = {
  source: "category",
  provider: "vendor-a",
  model_id: "primary",
  display: "vendor-a/primary",
} as const
const fallback = {
  source: "category",
  provider: "vendor-b",
  model_id: "fallback",
  display: "vendor-b/fallback",
  variant: "high",
} as const

function planner(plan: ResolvedChildPlan) {
  return () => ({ kind: "resolved", plan }) as const
}

function spillPlan(): ResolvedChildPlan {
  return {
    model: primary.display,
    requested_model: primary,
    resolved_model: primary,
    fallback_models: [fallback],
    category: "quick",
  }
}

afterEach(cleanupProjects)

describe("TaskManager spawn spill admission", () => {
  test("#given a full primary and free fallback #when spawning #then every launch fact uses the fallback", async () => {
    const { manager, store, inProcess } = makeManager({
      planner: planner(spillPlan()),
      config: settings({
        default_concurrency: 1,
        max_depth: 1,
        nicknames: {
          sets: { primary: ["Selene"], fallback: ["Helios"] },
          models: { [primary.display]: "primary", [fallback.display]: "fallback" },
        },
      }),
    })
    const holder = await manager.start(baseSpec({ name: "holder", model: primary.display }))
    if (holder.kind !== "started") throw new Error("expected holder")
    expect(holder.nickname).toBe("Selene")

    const result = await manager.start(baseSpec({ name: "spill" }))

    expect(result).toMatchObject({ kind: "started", status: "running", resolved_model: fallback, nickname: "Helios" })
    if (result.kind !== "started") throw new Error("expected spill")
    const record = store.load(result.task_id)
    expect(record).toMatchObject({
      model: fallback.display,
      nickname: "Helios",
      requested_model: primary,
      resolved_model: fallback,
      fallback_models: [],
    })
    expect(record?.fallback_attempts).toBeUndefined()
    expect(inProcess.startedSpecs.find((spec) => spec.taskId === result.task_id)).toMatchObject({
      model: fallback.display,
      requestedModel: primary,
      resolvedModel: fallback,
      fallbackModels: [],
    })
    expect(record?.spawn_spec).toMatchObject({ version: 1 })
  })

  test("#given a full global cap and a locally free fallback #when spawning #then it queues on the primary", async () => {
    const { manager, store } = makeManager({
      planner: planner(spillPlan()),
      config: settings({ default_concurrency: 1, global_concurrency: 1, max_depth: 1 }),
    })
    const holder = await manager.start(baseSpec({ name: "holder" }))
    if (holder.kind !== "started") throw new Error("expected holder")

    const result = await manager.start(baseSpec({ name: "blocked" }))

    expect(result).toMatchObject({ kind: "started", status: "pending", queue_position: 1, resolved_model: primary })
    if (result.kind !== "started") throw new Error("expected pending")
    expect(store.load(result.task_id)).toMatchObject({ model: primary.display, resolved_model: primary })
  })

  test("#given a nickname reservation is waiting #when its claimed task is cancelled #then it never launches", async () => {
    const project = tempProject()
    const store = createTaskRecordStore(ownedTaskState(project))
    const { promise: claimed, resolve: claim } = Promise.withResolvers<string>()
    const { manager, inProcess } = makeManager({
      project,
      store: {
        ...store,
        save(record) {
          store.save(record)
          claim(record.task_id)
        },
      },
      planner: planner(spillPlan()),
      config: settings({
        global_concurrency: 1,
        nicknames: { sets: { moon: ["Selene"] }, default: "moon" },
      }),
    })

    const { promise: held, resolve: acquired } = Promise.withResolvers<undefined>()
    const { promise: released, resolve: release } = Promise.withResolvers<undefined>()
    const lock = withTaskRecordLockAsync(join(project, "task-nicknames.json"), () => {
      acquired(undefined)
      return released
    })
    const [result, taskId] = await (async () => {
      try {
        await awaitWithinTestBudget(Promise.race([held, lock]), "nickname lock acquisition")
        const starting = manager.start(baseSpec())
        const taskId = await awaitWithinTestBudget(claimed, "task claim before nickname assignment")
        expect(await manager.cancelTask(taskId)).toMatchObject({ kind: "cancelled", task_id: taskId })
        release(undefined)
        return [await starting, taskId] as const
      } finally {
        release(undefined)
        await lock
      }
    })()

    expect(result).toMatchObject({ kind: "start_failed", task_id: taskId })
    expect(store.load(taskId)?.status).toBe("cancelled")
    expect(inProcess.startedSpecs).toHaveLength(0)
    expect(await manager.start(baseSpec())).toMatchObject({ kind: "started", status: "running" })
  })

  test("#given provider-collapsed candidates #when the provider lane is full #then the fallback cannot bypass it", async () => {
    const sameProviderFallback = { ...fallback, provider: "vendor-a", display: "vendor-a/fallback" }
    const { manager } = makeManager({
      planner: planner({ ...spillPlan(), fallback_models: [sameProviderFallback] }),
      config: settings({ default_concurrency: 5, provider_concurrency: { "vendor-a": 1 }, max_depth: 1 }),
    })
    await manager.start(baseSpec({ name: "holder" }))

    const result = await manager.start(baseSpec({ name: "blocked" }))

    expect(result).toMatchObject({ kind: "started", status: "pending", queue_position: 1, resolved_model: primary })
  })

  test("#given a provider primary lane and exact-model fallback lane #when primary is full #then the exact fallback remains distinct", async () => {
    const { manager } = makeManager({
      planner: planner(spillPlan()),
      config: settings({
        default_concurrency: 5,
        provider_concurrency: { "vendor-a": 1 },
        model_concurrency: { [fallback.display]: 1 },
        max_depth: 1,
      }),
    })
    await manager.start(baseSpec({ name: "holder" }))

    const result = await manager.start(baseSpec({ name: "spill" }))

    expect(result).toMatchObject({ kind: "started", status: "running", resolved_model: fallback })
  })

  test("#given revive capacity is full #when a terminal task is sent #then it defers without sending and retries after release", async () => {
    const { manager, inProcess, store } = makeManager({
      config: settings({ default_concurrency: 1, global_concurrency: 1, max_depth: 1 }),
    })
    const terminal = await manager.start(baseSpec({ name: "terminal" }))
    if (terminal.kind !== "started") throw new Error("expected terminal")
    const terminalHandle = inProcess.handles.get(terminal.task_id)
    terminalHandle?.settle({ status: "completed", finalResponse: "done" })
    await flush()
    const holder = await manager.start(baseSpec({ name: "holder" }))
    if (holder.kind !== "started") throw new Error("expected holder")

    const deferred = await manager.sendToTask({ idOrName: terminal.task_id, message: "again" })

    expect(deferred).toMatchObject({ kind: "capacity_deferred", task_id: terminal.task_id })
    expect(terminalHandle?.followUpCalls).toEqual([])
    expect(store.load(terminal.task_id)?.status).toBe("completed")
    await manager.cancelTask(holder.task_id)
    const revived = await manager.sendToTask({ idOrName: terminal.task_id, message: "again" })
    expect(revived).toMatchObject({ kind: "revived", task_id: terminal.task_id })
    expect(terminalHandle?.followUpCalls).toEqual(["again"])
  })

  test("#given two global permits are occupied on distinct lanes #when spawning on a free third lane #then it queues", async () => {
    const plans = new Map([
      ["one", { model: "vendor-a/one" }],
      ["two", { model: "vendor-b/two" }],
      ["three", { model: "vendor-c/three" }],
    ])
    const { manager } = makeManager({
      planner: (spec) => ({ kind: "resolved", plan: plans.get(spec.name ?? "") ?? { model: "vendor-z/default" } }),
      config: settings({ default_concurrency: 1, global_concurrency: 2, max_depth: 1 }),
    })
    await manager.start(baseSpec({ name: "one" }))
    await manager.start(baseSpec({ name: "two" }))

    const third = await manager.start(baseSpec({ name: "three" }))

    expect(third).toMatchObject({ kind: "started", status: "pending", queue_position: 1 })
  })
})
