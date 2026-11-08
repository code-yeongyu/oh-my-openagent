import { afterEach, expect, test } from "bun:test"
import { seedRecord } from "../lifecycle/__fixtures__/lifecycle-fakes"
import { AdmissionBarrier } from "../pause/admission-barrier"
import { createTaskRecordStore } from "../store"
import { categoryPlanner, cleanupProjects, FakeRunner, makeHandle, settings, tempProject } from "./__fixtures__/manager-fakes"
import { createTaskManager } from "./manager"

afterEach(cleanupProjects)

// The paused reattachment contract differs from ordinary revival: binding the
// surviving child must not start a new task epoch or subscribe to its old turn.
test("reattaching a paused child preserves its epoch and leaves its old turn unobserved", async () => {
  const cwd = tempProject()
  const store = createTaskRecordStore({ project_dir: cwd })
  const taskId = "st_0a675201"
  const before = seedRecord(store, {
    task_id: taskId, status: "paused", residency_state: "resident", host_pid: process.pid,
    parent_session_id: "parent", child_session_id: "old-child-session", run_epoch: 7,
  })
  const barrier = new AdmissionBarrier()
  barrier.close("parent", 1)
  const runner = new FakeRunner()
  const native = makeHandle(taskId)
  let observedOldTurn = 0
  const handle = {
    ...native.handle,
    waitForOutcome: () => {
      observedOldTurn += 1
      return native.handle.waitForOutcome()
    },
  }
  const manager = createTaskManager({
    cwd, store, admissionBarrier: barrier, planner: categoryPlanner(),
    config: settings(), runners: { "in-process": runner, process: runner },
  })
  try {
    const result = await manager.reattach(before, handle)

    expect(result).toEqual({ ok: true })
    expect(manager.get(taskId)?.status).toBe("paused")
    expect(manager.get(taskId)?.notification.run_epoch).toBe(7)
    expect(manager.get(taskId)?.child_session_id).toBe(handle.sessionId)
    expect(manager.getResidentHandle(taskId)).toBe(handle)
    expect(observedOldTurn).toBe(0)
    expect(manager.concurrency?.leaseState(taskId, before.notification.run_epoch)).toBeUndefined()
    expect(runner.startedSpecs).toHaveLength(0)
  } finally {
    manager.forget(taskId, { path: "park" })
    native.settle({ status: "cancelled" })
    manager.workpools.dispose()
  }
})
