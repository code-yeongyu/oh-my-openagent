import { createManagerResidencyRegistry } from "../../../../omo-senpi/src/components/task/residency-registry"
import { createTaskLifecycle } from "../../lifecycle/create"
import type { TaskRecordStore } from "../../store"
import type { ManagedChildHandle } from "../child-handle"
import { createTaskManager } from "../manager"
import type { ManagedRunner, ManagedStartSpec, ResolvedChildPlan, TaskManager } from "../types"
import { makeHandle, settings } from "./manager-fakes"

export const PRIMARY = "vendor/primary"
export const NEXT = "vendor/next"
export const plan: ResolvedChildPlan = {
  model: PRIMARY,
  requested_model: { source: "category", provider: "vendor", model_id: "primary", display: PRIMARY },
  resolved_model: { source: "category", provider: "vendor", model_id: "primary", display: PRIMARY },
  fallback_models: [{ source: "category", provider: "vendor", model_id: "next", display: NEXT }],
}

/** The first start returns at once; the second (the next rung) waits until the test releases it. */
export class HeldSecondStart implements ManagedRunner {
  readonly entered = Promise.withResolvers<void>()
  readonly release = Promise.withResolvers<void>()
  readonly disposed = Promise.withResolvers<void>()
  first: ReturnType<typeof makeHandle> | undefined
  second: ReturnType<typeof makeHandle> | undefined
  calls = 0

  async start(spec: ManagedStartSpec): Promise<ManagedChildHandle> {
    this.calls += 1
    if (this.calls === 1) {
      this.first = makeHandle(spec.taskId)
      return this.first.handle
    }
    this.entered.resolve()
    await this.release.promise
    this.second = makeHandle(spec.taskId)
    const handle = this.second.handle
    return {
      ...handle,
      dispose: async () => {
        await handle.dispose()
        this.disposed.resolve()
      },
    }
  }
}

/** Tears a registered child down and forgets it, as the lifecycle's destruction port does. */
export function managerOver(store: TaskRecordStore, runner: ManagedRunner, project: string, destroy?: (taskId: string, cause: string) => Promise<void>) {
  let manager: TaskManager | undefined
  const built = createTaskManager({
    store,
    runners: { "in-process": runner, process: runner },
    planner: () => ({ kind: "resolved", plan }),
    config: settings({ default_concurrency: 2, max_depth: 1 }),
    cwd: project,
    destruction: {
      destroyResidentTask: destroy ?? (async (taskId) => {
        const handle = manager?.getResidentHandle(taskId)
        manager?.forget(taskId)
        await handle?.dispose()
      }),
    },
  })
  manager = built
  return built
}

export const HOST_PID = 21_001

/** A manager over the REAL destruction port, so a child whose cleanup failed must reach the orphan path. */
export function managerWithLifecycle(store: TaskRecordStore, runner: ManagedRunner, project: string, alive: Set<number>, now: () => number = Date.now) {
  const terminated = Promise.withResolvers<number>()
  const orphaned = Promise.withResolvers<void>()
  const signals: string[] = []
  let manager: TaskManager | undefined
  const lifecycle = createTaskLifecycle({
    store,
    config: settings({ default_concurrency: 2, max_depth: 1 }),
    hostPid: HOST_PID,
    now,
    registry: createManagerResidencyRegistry(() => {
      if (manager === undefined) throw new Error("manager not built")
      return manager
    }),
    orphanKillDelayMs: 0,
    signaller: {
      isAlive: (pid) => alive.has(pid),
      signal: (pid, signal) => {
        signals.push(`${signal}:${pid}`)
        alive.delete(pid)
        terminated.resolve(pid)
      },
    },
  })
  const built = createTaskManager({
    store,
    runners: { "in-process": runner, process: runner },
    planner: () => ({ kind: "resolved", plan }),
    config: settings({ default_concurrency: 2, max_depth: 1 }),
    cwd: project,
    hostPid: HOST_PID,
    destruction: {
      destroyResidentTask: async (taskId, cause) => {
        try {
          await lifecycle.destroyResidentTask(taskId, cause)
        } finally {
          if (cause === "reconcile_lost") orphaned.resolve()
        }
      },
    },
  })
  manager = built
  return { manager: built, lifecycle, signals, terminated: terminated.promise, orphaned: orphaned.promise }
}

/** A per-process child whose terminate and dispose both reject: it stays alive until signalled. */
export function stubbornChild(taskId: string, pid: number, disposed?: () => void): ManagedChildHandle {
  const { handle } = makeHandle(taskId, pid)
  return {
    ...handle,
    kind: "rpc",
    terminate: async () => { throw new Error("terminate rejected") },
    dispose: async () => {
      disposed?.()
      throw new Error("dispose rejected")
    },
  }
}

/** An in-process child whose teardown rejects until `closable` is set: it has no pid and no session. */
export function inProcessChild(taskId: string, state: { closable: boolean; disposals: number }): ReturnType<typeof makeHandle> {
  const fake = makeHandle(taskId)
  Object.assign(fake.handle, {
    kind: "in-process" as const,
    abort: async () => { if (!state.closable) throw new Error("abort rejected") },
    dispose: async () => {
      state.disposals += 1
      if (!state.closable) throw new Error("dispose rejected")
    },
  })
  return fake
}
