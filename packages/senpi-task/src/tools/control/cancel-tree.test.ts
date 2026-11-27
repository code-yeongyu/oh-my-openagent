import { afterEach, describe, expect, test } from "bun:test"

import { testBudgetSignal } from "../../../../../test-support/test-deadline"

import { readEvents } from "../../lifecycle/__fixtures__/lifecycle-fakes"
import { createTaskLifecycle } from "../../lifecycle/create"
import { NO_HOST_ENDPOINT } from "../../lifecycle/host-session"
import type { ResidencyRegistry, ResidentHandle } from "../../lifecycle/port"
import type { TaskLifecycle } from "../../lifecycle/types"
import {
  baseSpec,
  cleanupProjects,
  launchSettled,
  makeManager,
  settings,
} from "../../manager/__fixtures__/manager-fakes"
import type { ManagedChildHandle } from "../../manager/child-handle"
import type { TaskManager } from "../../manager/types"
import { runTaskOutput } from "../output/output"
import { runTaskCancel } from "./cancel"

const lifecycles: TaskLifecycle[] = []

afterEach(() => {
  for (const lifecycle of lifecycles.splice(0)) lifecycle.dispose?.()
  return cleanupProjects()
})

const ROOT = "sess-R"

function residentOf(handle: ManagedChildHandle | undefined): ResidentHandle | undefined {
  if (handle === undefined) return undefined
  return {
    task_id: handle.task_id,
    kind: handle.kind ?? "in-process",
    pid: handle.pid,
    abort: () => handle.abort(),
    dispose: () => handle.dispose(),
    terminate: () => Promise.resolve(),
  }
}

function registryOver(manager: () => TaskManager): ResidencyRegistry {
  return {
    get: (taskId) => residentOf(manager().getResidentHandle(taskId)),
    entries: () =>
      manager()
        .residentTaskIds()
        .flatMap((taskId) => residentOf(manager().getResidentHandle(taskId)) ?? []),
    forget: (taskId, options) => manager().forget(taskId, options),
    hasPendingSends: (taskId) => manager().hasPendingSends?.(taskId) ?? false,
  }
}

function managerWithLifecycle() {
  const config = settings({ default_concurrency: 5, max_depth: 2 })
  let lifecycle: TaskLifecycle | undefined
  const destroyer = (): TaskLifecycle => {
    if (lifecycle === undefined) throw new Error("the lifecycle is not composed yet")
    return lifecycle
  }
  const built = makeManager({
    config,
    destruction: { destroyResidentTask: (taskId, cause) => destroyer().destroyResidentTask(taskId, cause) },
  })
  lifecycle = createTaskLifecycle({
    hostEndpoint: NO_HOST_ENDPOINT,
    store: built.store,
    registry: registryOver(() => built.manager),
    config,
  })
  lifecycles.push(lifecycle)
  return { ...built, lifecycle }
}

describe("a root's cancel of a grandchild is the terminal state its middle child reads", () => {
  test("#given a running middle child and its running task #when the root session cancels that task #then the middle child reads it cancelled and is itself untouched", async () => {
    const { manager, store } = managerWithLifecycle()
    const middle = await manager.start(baseSpec({ parent_session_id: ROOT, root_session_id: ROOT }))
    if (middle.kind !== "started") throw new Error(`middle child did not start: ${middle.kind}`)
    await launchSettled(manager, middle.task_id)
    const middleSession = manager.get(middle.task_id)?.child_session_id
    if (middleSession === undefined) throw new Error("the middle child has no session id")
    const grandchild = await manager.start(
      baseSpec({ parent_session_id: middleSession, root_session_id: ROOT, depth: 2 }),
    )
    if (grandchild.kind !== "started") throw new Error(`grandchild did not start: ${grandchild.kind}`)
    await launchSettled(manager, grandchild.task_id)
    expect(manager.get(grandchild.task_id)?.status).toBe("running")
    const middleBefore = store.load(middle.task_id)
    const middleWait = manager.waitFor(grandchild.task_id, { signal: testBudgetSignal("the middle session's wait") })

    const cancelled = await runTaskCancel(manager, { task_id: grandchild.task_id }, ROOT)

    expect(cancelled.details).toMatchObject({
      kind: "cancelled",
      task_id: grandchild.task_id,
      previous_status: "running",
      status: "cancelled",
    })

    const output = await runTaskOutput(
      { manager, stateDir: store.stateDir },
      { task_id: grandchild.task_id },
      middleSession,
    )
    expect(output.details).toMatchObject({
      kind: "status",
      snapshot: { task_id: grandchild.task_id, status: "cancelled" },
    })
    expect((await middleWait).status).toBe("cancelled")
    expect(
      manager.list({ scope: "parent-session", session_id: middleSession }).map((entry) => entry.record.status),
    ).toEqual(["cancelled"])

    expect(store.load(middle.task_id)).toEqual(middleBefore)
    expect(store.load(middle.task_id)?.status).toBe("running")
    expect(manager.getResidentHandle(middle.task_id)).toBeDefined()

    expect(store.load(grandchild.task_id)?.status).toBe("cancelled")
    expect(readEvents(store, grandchild.task_id)).toContain("cancelled")
    expect(manager.getResidentHandle(grandchild.task_id)).toBeUndefined()
    expect(manager.residentTaskIds()).not.toContain(grandchild.task_id)
  })
})
