import { OmoTaskSettingsSchema } from "@oh-my-opencode/omo-config-core"
import { createTaskManager } from "../../manager/manager"
import { createTaskRecordStore } from "../../store"
import { createTaskLifecycle } from "../../lifecycle"
import type { ResidencyRegistry } from "../../lifecycle/port"
import { fixtureHandle } from "./admission"
import type { PendingSteeringEntry } from "../../state"

export function restartedFixture(project: string) {
  const store = createTaskRecordStore({ project_dir: project })
  const config = OmoTaskSettingsSchema.parse({ default_concurrency: 1, global_concurrency: 1 })
  const children = new Map<string, ReturnType<typeof fixtureHandle>>()
  const queues: (readonly PendingSteeringEntry[])[] = []
  const runner = {
    start: async (): Promise<never> => { throw new Error("Recovery must not replay the initial prompt") },
    resume: async (spec: { taskId: string }) => {
      queues.push(store.load(spec.taskId)?.pending_steering ?? [])
      const child = fixtureHandle(spec.taskId)
      children.set(spec.taskId, child)
      return child.handle
    },
  }
  const manager = createTaskManager({ store, config, cwd: project, runners: { "in-process": runner, process: runner },
    planner: () => ({ kind: "resolved", plan: { model: "test/model" } }),
    destruction: { destroyResidentTask: (id, cause) => lifecycle.destroyResidentTask(id, cause) },
  })
  const registry: ResidencyRegistry = {
    get: taskId => {
      const child = manager.getResidentHandle(taskId)
      return child === undefined ? undefined : { task_id: taskId, kind: "in-process", pid: undefined,
        abort: () => child.abort(), dispose: () => child.dispose(), terminate: async () => undefined }
    },
    entries: () => manager.residentTaskIds().flatMap(id => { const child = registry.get(id); return child === undefined ? [] : [child] }),
    forget: taskId => manager.forget(taskId), hasPendingSends: taskId => manager.hasPendingSends?.(taskId) ?? false,
    tryClaimEviction: taskId => manager.tryClaimEviction?.(taskId) ?? false, releaseEviction: taskId => manager.releaseEviction?.(taskId),
  }
  const lifecycle = createTaskLifecycle({ store, registry, config })
  return { manager, store, queues, children,
    cleanup: async () => {
      manager.workpools.dispose()
      lifecycle.dispose?.()
      for (const taskId of manager.residentTaskIds()) await lifecycle.destroyResidentTask(taskId, "cancel")
    },
  }
}
