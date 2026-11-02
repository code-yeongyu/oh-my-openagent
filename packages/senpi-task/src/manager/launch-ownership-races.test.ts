import { afterEach, describe, expect, test } from "bun:test"

import { RunnerError } from "../runners/in-process/runner-error"
import type { TaskRecord } from "../state"
import { createTaskRecordStore } from "../store"
import type { ManagedChildHandle } from "./child-handle"
import { createTaskManager } from "./manager"
import type { ManagedRunner, ManagedStartSpec, ResolvedChildPlan } from "./types"
import { baseSpec, categoryPlanner, cleanupProjects, FakeRunner, makeHandle, settings, tempProject } from "./__fixtures__/manager-fakes"

afterEach(cleanupProjects)

const PRIMARY = "vendor/primary"
const NEXT = "vendor/next"
const plan: ResolvedChildPlan = {
  model: PRIMARY,
  requested_model: { source: "category", provider: "vendor", model_id: "primary", display: PRIMARY },
  resolved_model: { source: "category", provider: "vendor", model_id: "primary", display: PRIMARY },
  fallback_models: [{ source: "category", provider: "vendor", model_id: "next", display: NEXT }],
}

/** The primary start parks until released, then either returns a child or refuses the model. */
class HeldPrimaryStart implements ManagedRunner {
  readonly entered = Promise.withResolvers<void>()
  readonly release = Promise.withResolvers<void>()
  readonly disposed = Promise.withResolvers<void>()
  readonly models: string[] = []
  constructor(private readonly outcome: "child" | "model_unavailable") {}

  async start(spec: ManagedStartSpec): Promise<ManagedChildHandle> {
    this.models.push(spec.model ?? "")
    this.entered.resolve()
    await this.release.promise
    if (this.outcome === "model_unavailable") throw new RunnerError({ kind: "model_unavailable", message: `${spec.model} is unavailable` })
    const { handle } = makeHandle(spec.taskId)
    return {
      ...handle,
      dispose: async () => {
        await handle.dispose()
        this.disposed.resolve()
      },
    }
  }
}

function managerOver(runner: ManagedRunner, project: string) {
  const store = createTaskRecordStore({ project_dir: project })
  const manager = createTaskManager({
    store,
    runners: { "in-process": runner, process: runner },
    planner: () => ({ kind: "resolved", plan }),
    config: settings({ default_concurrency: 2, max_depth: 1 }),
    cwd: project,
    destruction: { destroyResidentTask: async () => {} },
  })
  return { store, manager }
}

describe("a stop that lands while a primary start is in flight", () => {
  test("#given the primary start is in flight #when the task is interrupted #then the late child is discarded and never becomes resident", async () => {
    const runner = new HeldPrimaryStart("child")
    const { store, manager } = managerOver(runner, tempProject())
    const starting = manager.start(baseSpec())
    await runner.entered.promise
    const taskId = store.list().records[0]?.task_id
    if (taskId === undefined) throw new Error("record not created")

    expect((await manager.interruptTask(taskId)).kind).toBe("interrupted")
    runner.release.resolve()
    await starting
    await runner.disposed.promise

    expect(store.load(taskId)?.status).toBe("interrupted")
    expect(manager.getResidentHandle(taskId)).toBeUndefined()
    manager.workpools.dispose()
  })

  test("#given the primary start is in flight #when the task is cancelled and the start then refuses its model #then no other model is tried and the cancel stands", async () => {
    const runner = new HeldPrimaryStart("model_unavailable")
    const { store, manager } = managerOver(runner, tempProject())
    const starting = manager.start(baseSpec())
    await runner.entered.promise
    const taskId = store.list().records[0]?.task_id
    if (taskId === undefined) throw new Error("record not created")
    const epoch = store.load(taskId)?.notification.run_epoch

    expect((await manager.cancelTask(taskId)).kind).toBe("cancelled")
    runner.release.resolve()
    await starting

    expect(runner.models).toEqual([PRIMARY])
    expect(store.load(taskId)).toMatchObject({ status: "cancelled", model: PRIMARY })
    expect(store.load(taskId)?.notification.run_epoch).toBe(epoch)
    manager.workpools.dispose()
  })
})

describe("a respawned child reattached after its task ended", () => {
  test("#given a running task is cancelled while its respawn is in flight #when the respawned child is reattached #then it is refused and discarded", async () => {
    const project = tempProject()
    const store = createTaskRecordStore({ project_dir: project })
    store.list()
    const running: TaskRecord = {
      task_id: "st_0badf00d",
      name: "reattach-after-cancel",
      parent_session_id: "parent-1",
      root_session_id: "parent-1",
      depth: 1,
      execution_mode: "process",
      model: PRIMARY,
      notify_on_terminal: false,
      status: "running",
      residency_state: "resident",
      host_pid: 7_001,
      created_at: "2026-09-27T00:00:00.000Z",
      updated_at: "2026-09-27T00:00:00.000Z",
      notification: { run_epoch: 2, notified_epoch: 1 },
    }
    store.replace(running)
    const manager = createTaskManager({
      store,
      runners: { "in-process": new FakeRunner(), process: new FakeRunner() },
      planner: categoryPlanner(),
      config: settings(),
      cwd: project,
      hostPid: 7_001,
    })
    store.transition(running.task_id, { type: "cancel", timestamp: "2026-09-27T00:00:01.000Z" })
    const disposed = Promise.withResolvers<void>()
    const { handle } = makeHandle(running.task_id)

    const result = await manager.reattach(running, { ...handle, dispose: async () => { disposed.resolve() } })
    await disposed.promise

    expect(result.ok).toBe(false)
    expect(manager.getResidentHandle(running.task_id)).toBeUndefined()
    expect(store.load(running.task_id)).toMatchObject({ status: "cancelled", notification: { run_epoch: 2 } })
    manager.workpools.dispose()
  })
})
