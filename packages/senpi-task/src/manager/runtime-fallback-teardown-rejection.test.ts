import { afterEach, describe, expect, test } from "bun:test"

import { createTaskRecordStore, type TaskRecordStore } from "../store"
import type { ManagedRunner } from "./types"
import { baseSpec, cleanupProjects, makeHandle, tempProject } from "./__fixtures__/manager-fakes"
import { managerOver, managerWithLifecycle, PRIMARY, stubbornChild } from "./__fixtures__/fallback-launch-fakes"

afterEach(cleanupProjects)

describe("runtime fallback: the failed rung's teardown rejects", () => {
  for (const [label, rejection] of [["an Error", new Error("dispose rejected")], ["undefined", undefined], ["a string", "dispose rejected"]] as const) test(`#given the failed rung's teardown rejects with ${label} #when the handoff was committed #then the task ends in error, is released, and no next rung starts`, async () => {
    const project = tempProject()
    const store = createTaskRecordStore({ project_dir: project })
    const starts: string[] = []
    let first: ReturnType<typeof makeHandle> | undefined
    const runner: ManagedRunner = {
      start: async (spec) => {
        starts.push(spec.model ?? "")
        first = makeHandle(spec.taskId)
        return first.handle
      },
    }
    const manager = managerOver(store, runner, project, async (_taskId, cause) => {
      if (cause === "fallback_handoff") return Promise.reject(rejection)
    })
    const started = await manager.start(baseSpec())
    if (started.kind !== "started" || first === undefined) throw new Error("setup failed")

    const terminal = manager.waitFor(started.task_id)
    first.settle({ status: "error", failure: { kind: "child-turn-failed", message: "500: upstream overloaded" } })
    const ended = await terminal

    expect(ended.status).toBe("error")
    expect(ended.error_message).toContain(rejection === undefined ? "was not started" : "dispose rejected")
    expect(ended.fallback_handoff_epoch).toBeUndefined()
    expect(starts).toEqual([PRIMARY])
    // An in-process child has no pid or session to hand the orphan path: it stays resident as its own cleanup owner.
    expect(manager.getResidentHandle(started.task_id)?.task_id).toBe(started.task_id)
    const other = await manager.start(baseSpec({ name: "after" }))
    expect(other).toMatchObject({ kind: "started", status: "running" })
    manager.workpools.dispose()
  })

  test("#given a cancel lands while the stranded handoff is being failed #when the failure is written #then the cancel is kept", async () => {
    const project = tempProject()
    const backing = createTaskRecordStore({ project_dir: project })
    let injectCancel = false
    const cancelNow = (taskId: string): void => {
      if (!injectCancel) return
      injectCancel = false
      backing.transition(taskId, { type: "cancel", timestamp: "2026-09-27T00:00:00.000Z" })
    }
    // The first store access after the teardown rejects races a user cancel: a read returns the
    // snapshot taken before the cancel, a write lands after it.
    const store: TaskRecordStore = {
      ...backing,
      load(taskId) {
        const observed = backing.load(taskId)
        cancelNow(taskId)
        return observed
      },
      mutate(taskId, update) {
        cancelNow(taskId)
        return backing.mutate(taskId, update)
      },
      replace(record) {
        cancelNow(record.task_id)
        return backing.replace(record)
      },
    }
    let first: ReturnType<typeof makeHandle> | undefined
    const runner: ManagedRunner = {
      start: async (spec) => {
        first = makeHandle(spec.taskId)
        return first.handle
      },
    }
    const manager = managerOver(store, runner, project, async (_taskId, cause) => {
      if (cause !== "fallback_handoff") return
      injectCancel = true
      throw new Error("dispose rejected")
    })
    const started = await manager.start(baseSpec())
    if (started.kind !== "started" || first === undefined) throw new Error("setup failed")

    const terminal = manager.waitFor(started.task_id)
    first.settle({ status: "error", failure: { kind: "child-turn-failed", message: "500: upstream overloaded" } })

    expect((await terminal).status).toBe("cancelled")
    expect(backing.load(started.task_id)?.status).toBe("cancelled")
    manager.workpools.dispose()
  })
})

describe("runtime fallback: a child whose cleanup rejects is handed to orphan termination", () => {
  test("#given a stale next-rung child whose discard rejects #when the task was cancelled mid-start #then its pid is recorded and the orphan path signals it", async () => {
    const project = tempProject()
    const store = createTaskRecordStore({ project_dir: project })
    const alive = new Set([2_222])
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    let first: ReturnType<typeof makeHandle> | undefined
    const runner: ManagedRunner = {
      start: async (spec) => {
        if (first === undefined) {
          first = makeHandle(spec.taskId, 1_111)
          return Object.assign(first.handle, { kind: "rpc" as const, terminate: async () => {} })
        }
        entered.resolve()
        await release.promise
        return stubbornChild(spec.taskId, 2_222)
      },
    }
    const { manager, signals, terminated, orphaned } = managerWithLifecycle(store, runner, project, alive)
    const started = await manager.start(baseSpec({ execution_mode: "process" }))
    if (started.kind !== "started" || first === undefined) throw new Error("setup failed")
    first.settle({ status: "error", failure: { kind: "child-turn-failed", message: "500: upstream overloaded" } })
    await entered.promise
    expect((await manager.cancelTask(started.task_id)).kind).toBe("cancelled")

    release.resolve()

    expect(await terminated).toBe(2_222)
    await orphaned
    expect(signals[0]).toBe("SIGTERM:2222")
    expect(store.load(started.task_id)?.status).toBe("cancelled")
    expect(store.load(started.task_id)?.pid).toBeUndefined()
    expect(manager.getResidentHandle(started.task_id)).toBeUndefined()
    manager.workpools.dispose()
  })

  test("#given the failed rung's teardown rejects and its child stays alive #when the task is failed #then the failed rung's pid is restored and the orphan path signals it", async () => {
    const project = tempProject()
    const store = createTaskRecordStore({ project_dir: project })
    const alive = new Set([3_333])
    const starts: string[] = []
    let first: ReturnType<typeof makeHandle> | undefined
    const runner: ManagedRunner = {
      start: async (spec) => {
        starts.push(spec.model ?? "")
        first = makeHandle(spec.taskId, 3_333)
        return Object.assign(first.handle, stubbornChild(spec.taskId, 3_333), { waitForOutcome: first.handle.waitForOutcome, subscribe: first.handle.subscribe })
      },
    }
    const { manager, signals, terminated, orphaned } = managerWithLifecycle(store, runner, project, alive)
    const started = await manager.start(baseSpec({ execution_mode: "process" }))
    if (started.kind !== "started" || first === undefined) throw new Error("setup failed")

    const ended = manager.waitFor(started.task_id)
    first.settle({ status: "error", failure: { kind: "child-turn-failed", message: "500: upstream overloaded" } })

    expect((await ended).status).toBe("error")
    expect(await terminated).toBe(3_333)
    await orphaned
    expect(signals[0]).toBe("SIGTERM:3333")
    expect(store.load(started.task_id)?.status).toBe("error")
    expect(store.load(started.task_id)?.pid).toBeUndefined()
    expect(store.load(started.task_id)?.fallback_handoff_epoch).toBeUndefined()
    expect(starts).toEqual([PRIMARY])
    manager.workpools.dispose()
  })
})
