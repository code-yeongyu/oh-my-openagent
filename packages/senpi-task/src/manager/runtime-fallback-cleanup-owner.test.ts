import { afterEach, describe, expect, test } from "bun:test"

import { createTaskRecordStore, type TaskRecordStore } from "../store"
import type { ManagedRunner } from "./types"
import { baseSpec, cleanupProjects, makeHandle, tempProject } from "./__fixtures__/manager-fakes"
import { inProcessChild, managerWithLifecycle, PRIMARY } from "./__fixtures__/fallback-launch-fakes"

afterEach(cleanupProjects)

describe("runtime fallback: an in-process child whose cleanup rejects keeps a cleanup owner", () => {
  const LATER = () => Date.now() + 24 * 60 * 60 * 1_000

  test("#given the failed in-process rung's teardown rejects #when the task is failed #then the child stays resident and idle reclaim retries its teardown", async () => {
    const project = tempProject()
    const store = createTaskRecordStore({ project_dir: project })
    const state = { closable: false, disposals: 0 }
    const starts: string[] = []
    let first: ReturnType<typeof makeHandle> | undefined
    const runner: ManagedRunner = {
      start: async (spec) => {
        starts.push(spec.model ?? "")
        first = inProcessChild(spec.taskId, state)
        return first.handle
      },
    }
    let clock = Date.now
    const { manager, lifecycle } = managerWithLifecycle(store, runner, project, new Set(), () => clock())
    const started = await manager.start(baseSpec())
    if (started.kind !== "started" || first === undefined) throw new Error("setup failed")

    const ended = manager.waitFor(started.task_id)
    first.settle({ status: "error", failure: { kind: "child-turn-failed", message: "500: upstream overloaded" } })
    expect((await ended).status).toBe("error")

    expect(manager.getResidentHandle(started.task_id)?.task_id).toBe(started.task_id)
    expect(store.load(started.task_id)?.residency_state).toBe("resident")
    expect(starts).toEqual([PRIMARY])

    // A child kept only for cleanup is not a conversation: task_send must not revive it.
    const sent = await manager.sendToTask({ idOrName: started.task_id, message: "continue", callerSessionId: "parent-1" })
    expect(sent.kind).toBe("not_continuable")
    expect(first.followUpCalls).toEqual([])
    expect(store.load(started.task_id)?.status).toBe("error")

    // A retry that rejects again keeps the same owner for the next one.
    clock = LATER
    expect(await lifecycle.reclaimIdleResidents?.()).toEqual([])
    await lifecycle.suspendOnSessionShutdown({ parentSessionId: "parent-1", reason: "shutdown" })
    expect(state.disposals).toBe(3)
    expect(manager.getResidentHandle(started.task_id)?.task_id).toBe(started.task_id)
    expect(store.load(started.task_id)?.residency_state).toBe("resident")

    state.closable = true
    clock = LATER
    expect(await lifecycle.reclaimIdleResidents?.()).toEqual([started.task_id])
    expect(state.disposals).toBe(4)
    expect(manager.getResidentHandle(started.task_id)).toBeUndefined()
    manager.workpools.dispose()
  })

  test("#given a stale in-process next-rung child whose cleanup rejects #when the task was interrupted mid-start #then task_send is refused and the child is never messaged", async () => {
    const project = tempProject()
    const backing = createTaskRecordStore({ project_dir: project })
    // The late child's cleanup owner is decided in the first record write after its start resolves.
    const kept = Promise.withResolvers<void>()
    let armed = false
    const store: TaskRecordStore = {
      ...backing,
      mutate(taskId, update) {
        const result = backing.mutate(taskId, update)
        if (armed) kept.resolve()
        return result
      },
    }
    const state = { closable: false, disposals: 0 }
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    let first: ReturnType<typeof makeHandle> | undefined
    let late: ReturnType<typeof makeHandle> | undefined
    const runner: ManagedRunner = {
      start: async (spec) => {
        if (first === undefined) {
          first = makeHandle(spec.taskId)
          return first.handle
        }
        entered.resolve()
        await release.promise
        late = inProcessChild(spec.taskId, state)
        armed = true
        return late.handle
      },
    }
    const { manager } = managerWithLifecycle(store, runner, project, new Set())
    const started = await manager.start(baseSpec())
    if (started.kind !== "started" || first === undefined) throw new Error("setup failed")
    first.settle({ status: "error", failure: { kind: "child-turn-failed", message: "500: upstream overloaded" } })
    await entered.promise
    expect((await manager.interruptTask(started.task_id)).kind).toBe("interrupted")

    release.resolve()
    await kept.promise
    expect(manager.getResidentHandle(started.task_id)?.task_id).toBe(started.task_id)

    const sent = await manager.sendToTask({ idOrName: started.task_id, message: "continue", callerSessionId: "parent-1" })
    expect(sent.kind).toBe("not_continuable")
    expect(late?.followUpCalls).toEqual([])
    expect(store.load(started.task_id)?.status).toBe("interrupted")
    manager.workpools.dispose()
  })

  test("#given a stale in-process next-rung child whose cleanup rejects #when the task was cancelled mid-start #then it stays resident and idle reclaim retries its teardown", async () => {
    const project = tempProject()
    const backing = createTaskRecordStore({ project_dir: project })
    const keptResident = Promise.withResolvers<void>()
    const store: TaskRecordStore = {
      ...backing,
      transition(taskId, transition) {
        const result = backing.transition(taskId, transition)
        if (transition.type === "mark_resident") keptResident.resolve()
        return result
      },
    }
    const state = { closable: false, disposals: 0 }
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    let first: ReturnType<typeof makeHandle> | undefined
    let late: ReturnType<typeof makeHandle> | undefined
    const runner: ManagedRunner = {
      start: async (spec) => {
        if (first === undefined) {
          first = makeHandle(spec.taskId)
          return first.handle
        }
        entered.resolve()
        await release.promise
        late = inProcessChild(spec.taskId, state)
        return late.handle
      },
    }
    let clock = Date.now
    const { manager, lifecycle } = managerWithLifecycle(store, runner, project, new Set(), () => clock())
    const started = await manager.start(baseSpec())
    if (started.kind !== "started" || first === undefined) throw new Error("setup failed")
    first.settle({ status: "error", failure: { kind: "child-turn-failed", message: "500: upstream overloaded" } })
    await entered.promise
    expect((await manager.cancelTask(started.task_id)).kind).toBe("cancelled")

    release.resolve()
    await keptResident.promise

    expect(manager.getResidentHandle(started.task_id)?.task_id).toBe(started.task_id)
    expect(store.load(started.task_id)).toMatchObject({ status: "cancelled", residency_state: "resident" })

    state.closable = true
    clock = LATER
    expect(await lifecycle.reclaimIdleResidents?.()).toEqual([started.task_id])
    expect(state.disposals).toBe(2)
    expect(manager.getResidentHandle(started.task_id)).toBeUndefined()
    manager.workpools.dispose()
  })
})
