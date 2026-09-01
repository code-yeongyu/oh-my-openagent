import { afterEach, describe, expect, test } from "bun:test"

import { createTaskLifecycle, type ResidentHandle, type ResidencyRegistry } from "../lifecycle"
import { createTaskRecordStore } from "../store"
import type { ManagedChildHandle } from "./child-handle"
import {
  FakeRunner,
  baseSpec,
  categoryPlanner,
  cleanupProjects,
  settings,
  tempProject,
} from "./__fixtures__/manager-fakes"
import { createTaskManager } from "./manager"
import type { SpawnAdmission, TaskManager } from "./types"

afterEach(cleanupProjects)

function toResidentHandle(handle: ManagedChildHandle | undefined): ResidentHandle | undefined {
  if (handle === undefined) return undefined
  const kind = handle.pid === undefined ? "in-process" : "rpc"
  return {
    task_id: handle.task_id,
    kind,
    pid: handle.pid,
    abort: () => handle.abort(),
    dispose: () => handle.dispose(),
    terminate: () => (kind === "rpc" ? handle.abort() : Promise.resolve()),
  }
}

// residency_max_children: 0 is the numeric spelling of "unlimited" - the same wiring as
// residency-unlimited.test.ts, only the cap value differs.
function makeZeroCapManager(): TaskManager {
  const project = tempProject()
  const store = createTaskRecordStore({ project_dir: project })
  const runner = new FakeRunner()
  const config = settings({
    default_concurrency: 16,
    max_depth: 1,
    residency_max_children: 0,
  })
  let managerRef: TaskManager | undefined
  const manager = (): TaskManager => {
    if (managerRef === undefined) throw new Error("manager unavailable")
    return managerRef
  }
  const registry: ResidencyRegistry = {
    get: (taskId) => toResidentHandle(manager().getResidentHandle(taskId)),
    entries: () => manager().residentTaskIds().flatMap((taskId) => {
      const handle = toResidentHandle(manager().getResidentHandle(taskId))
      return handle === undefined ? [] : [handle]
    }),
    forget: (taskId) => manager().forget(taskId),
    hasPendingSends: () => false,
  }
  const lifecycle = createTaskLifecycle({ store, registry, config })
  managerRef = createTaskManager({
    store,
    runners: { "in-process": runner, process: runner },
    planner: categoryPlanner(),
    config,
    cwd: project,
    destruction: { destroyResidentTask: (taskId) => lifecycle.destroyResidentTask(taskId, "cancel") },
    admit: async (parentSessionId): Promise<SpawnAdmission> => {
      const admission = await lifecycle.admitResident(parentSessionId)
      if (admission.kind === "rejected") return { kind: "rejected", message: admission.error.message }
      if (admission.kind === "evicted") return { kind: "evicted", evicted_task_id: admission.evicted_task_id }
      return { kind: "admitted" }
    },
  })
  return managerRef
}

describe("TaskManager zero residency cap", () => {
  test("#given a zero residency cap #when sixteen children start #then admits more than the default residency cap", async () => {
    // given
    const manager = makeZeroCapManager()
    expect(settings().residency_max_children).toBe(8)

    // when
    const results = await Promise.all(
      Array.from({ length: 16 }, (_, index) => manager.start(baseSpec({ name: `child-${index + 1}` }))),
    )

    // then
    expect(results.every((result) => result.kind === "started")).toBe(true)
    expect(manager.residentTaskIds()).toHaveLength(16)
  })
})
