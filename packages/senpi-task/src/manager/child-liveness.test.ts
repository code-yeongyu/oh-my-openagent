import { afterEach, expect, test } from "bun:test"
import { fakeClock } from "../runners/rpc/__fixtures__/clock"
import type { HostLivenessStatus } from "../state/host-liveness"
import { createTaskRecordStore } from "../store"
import { runTaskSend } from "../tools/control/send"
import { baseSpec, categoryPlanner, cleanupProjects, makeHandle, settings, tempProject } from "./__fixtures__/manager-fakes"
import { createTaskManager } from "./manager"

let clock: ReturnType<typeof fakeClock>
afterEach(() => {
  clock?.restore()
  cleanupProjects()
})

async function observedChild() {
  clock = fakeClock()
  const project = tempProject()
  const fake = makeHandle("st_observed")
  let current: HostLivenessStatus = { state: "running" }
  const observers = new Set<(status: HostLivenessStatus) => void>()
  const notices: string[] = []
  const runner = {
    start: async (spec: { taskId: string }) => ({
      ...fake.handle, task_id: spec.taskId,
      liveness: () => current,
      onLiveness: (listener: (status: HostLivenessStatus) => void) => {
        observers.add(listener)
        return () => { observers.delete(listener) }
      },
    }),
  }
  const manager = createTaskManager({
    store: createTaskRecordStore({ project_dir: project }),
    runners: { "in-process": runner, process: runner },
    planner: categoryPlanner(), config: settings(), cwd: project,
    onChildLiveness: (_record, status) => { notices.push(status.state) },
  })
  const started = await manager.start(baseSpec({ run_in_background: true, execution_mode: "process" }))
  if (started.kind !== "started") throw new Error("expected a started child")
  return {
    manager, taskId: started.task_id, notices,
    status: (status: HostLivenessStatus) => {
      current = status
      for (const listener of observers) listener(status)
    },
    complete: async () => {
      const completed = manager.waitFor(started.task_id)
      fake.settle({ status: "completed", finalResponse: "finished first turn" })
      await completed
    },
    dispose: () => manager.forget(started.task_id, { path: "park" }),
  }
}

test("a completed resident child has a retryable unresponsive send result and can recover", async () => {
  // Given a finished child whose retained session is temporarily unavailable.
  const child = await observedChild()
  try {
    await child.complete()
    child.status({ state: "unresponsive", since: clock.now() })
    // When the parent sends work, the result must not imply permanent exit.
    const refused = await runTaskSend(child.manager, { to: child.taskId, message: "continue" }, "parent-1")
    expect(refused.details).toMatchObject({ kind: "unresponsive", task_id: child.taskId, retryable: true })
    expect(child.manager.get(child.taskId)?.status).toBe("completed")
    // Then the same handle accepts a retry after recovery.
    child.status({ state: "running" })
    const resumed = await runTaskSend(child.manager, { to: child.taskId, message: "continue" }, "parent-1")
    expect(resumed.details).toMatchObject({ kind: "revived", task_id: child.taskId })
  } finally {
    child.dispose()
  }
})

test("a completed resident child still reports persistent unresponsiveness", async () => {
  // Given a completed child that remains resident.
  const child = await observedChild()
  try {
    await child.complete()
    // When unresponsiveness survives the notice debounce window.
    child.status({ state: "unresponsive", since: clock.now() })
    await clock.advance(30_000)
    // Then the parent receives a status even though the previous turn completed.
    expect(child.notices).toEqual(["unresponsive"])
  } finally {
    child.dispose()
  }
})

test("brief liveness oscillations do not wake the parent but stable transitions do", async () => {
  // Given a congested child that produces activity every fifty seconds.
  const child = await observedChild()
  try {
    for (let i = 0; i < 12; i++) {
      await clock.advance(40_000)
      child.status({ state: "unresponsive", since: clock.now() })
      await clock.advance(10_000)
      child.status({ state: "running" })
    }
    // Then transient ten-second gaps produce no parent wake-ups.
    expect(child.notices).toEqual([])
    // Persistent degradation and recovery each produce one status.
    child.status({ state: "unresponsive", since: clock.now() })
    await clock.advance(30_000)
    child.status({ state: "running" })
    await clock.advance(30_000)
    expect(child.notices).toEqual(["unresponsive", "running"])
  } finally {
    child.dispose()
  }
})

test("terminal-pending bypasses the transient-status debounce", async () => {
  const child = await observedChild()
  try {
    child.status({ state: "unresponsive", since: 0 })
    child.status({ state: "terminal-pending", since: 0 })
    expect(child.notices).toEqual(["terminal-pending"])
    await clock.advance(30_000)
    expect(child.notices).toEqual(["terminal-pending"])
  } finally {
    child.dispose()
  }
})

test("forgetting a child cancels its pending liveness notice", async () => {
  const child = await observedChild()
  child.status({ state: "unresponsive", since: 0 })
  child.dispose()
  await clock.advance(30_000)
  expect(child.notices).toEqual([])
})
