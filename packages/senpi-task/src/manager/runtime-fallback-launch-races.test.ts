import { afterEach, describe, expect, test } from "bun:test"

import { createTaskRecordStore, type TaskRecordStore } from "../store"
import { createTaskManager } from "./manager"
import type { ManagedRunner, TaskManager } from "./types"
import { baseSpec, cleanupProjects, makeHandle, settings, tempProject } from "./__fixtures__/manager-fakes"
import { HeldSecondStart, managerOver, plan, PRIMARY } from "./__fixtures__/fallback-launch-fakes"

afterEach(cleanupProjects)

describe("runtime fallback: the next rung's start races a user stop", () => {
  for (const stop of ["cancel", "interrupt"] as const) {
    test(`#given the next rung's start is in flight #when the task is ${stop === "cancel" ? "cancelled" : "interrupted"} #then the late child is discarded and never becomes resident`, async () => {
      const project = tempProject()
      const store = createTaskRecordStore({ project_dir: project })
      const runner = new HeldSecondStart()
      const manager = managerOver(store, runner, project)
      const started = await manager.start(baseSpec())
      if (started.kind !== "started" || runner.first === undefined) throw new Error("setup failed")
      runner.first.settle({ status: "error", failure: { kind: "child-turn-failed", message: "500: upstream overloaded" } })
      await runner.entered.promise

      const stopped = stop === "cancel" ? await manager.cancelTask(started.task_id) : await manager.interruptTask(started.task_id)
      expect(stopped.kind).toBe(stop === "cancel" ? "cancelled" : "interrupted")

      runner.release.resolve()
      await runner.disposed.promise

      expect(manager.getResidentHandle(started.task_id)).toBeUndefined()
      expect(store.load(started.task_id)?.status).toBe(stop === "cancel" ? "cancelled" : "interrupted")
      manager.workpools.dispose()
    })
  }
})

describe("runtime fallback: a stop that lands just before the handoff is written", () => {
  for (const stop of ["cancel", "interrupt"] as const) {
    test(`#given the failed rung's outcome is being handed off #when the task is ${stop === "cancel" ? "cancelled" : "interrupted"} just before the handoff write #then the stop stands, nothing is handed off, and the lane is free`, async () => {
      const project = tempProject()
      const backing = createTaskRecordStore({ project_dir: project })
      let manager: TaskManager | undefined
      let armed = false
      let stopped: Promise<unknown> | undefined
      // The user's stop runs its synchronous transition inside the first record write after the failure.
      const store: TaskRecordStore = {
        ...backing,
        mutate(taskId, update) {
          if (armed && manager !== undefined) {
            armed = false
            stopped = stop === "cancel" ? manager.cancelTask(taskId) : manager.interruptTask(taskId)
          }
          return backing.mutate(taskId, update)
        },
      }
      const starts: string[] = []
      let first: ReturnType<typeof makeHandle> | undefined
      const runner: ManagedRunner = {
        start: async (spec) => {
          starts.push(spec.model ?? "")
          const fake = makeHandle(spec.taskId)
          first ??= fake
          return fake.handle
        },
      }
      const built = createTaskManager({
        store,
        runners: { "in-process": runner, process: runner },
        planner: () => ({ kind: "resolved", plan }),
        config: settings({ default_concurrency: 1, max_depth: 1 }),
        cwd: project,
        destruction: {
          destroyResidentTask: async (taskId) => {
            const handle = built.getResidentHandle(taskId)
            built.forget(taskId)
            await handle?.dispose()
          },
        },
      })
      manager = built
      const started = await built.start(baseSpec())
      if (started.kind !== "started" || first === undefined) throw new Error("setup failed")

      const ended = built.waitFor(started.task_id)
      armed = true
      first.settle({ status: "error", failure: { kind: "child-turn-failed", message: "500: upstream overloaded" } })
      await ended
      await stopped

      const record = backing.load(started.task_id)
      expect(record?.status).toBe(stop === "cancel" ? "cancelled" : "interrupted")
      expect(record?.notification.run_epoch).toBe(0)
      expect(record?.model).toBe(PRIMARY)
      expect(record?.fallback_handoff_epoch).toBeUndefined()
      expect(starts).toEqual([PRIMARY])
      expect(await built.start(baseSpec({ name: "after" }))).toMatchObject({ kind: "started", status: "running" })
      built.workpools.dispose()
    })
  }
})
