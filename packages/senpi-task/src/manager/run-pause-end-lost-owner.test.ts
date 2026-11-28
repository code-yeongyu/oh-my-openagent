import { afterEach, expect, test } from "bun:test"
import { seedRecord } from "../lifecycle/__fixtures__/lifecycle-fakes"
import { createTaskRecordStore } from "../store"
import { ownedTaskState } from "../store/__fixtures__/owned-task-state"
import { categoryPlanner, cleanupProjects, makeHandle, settings, tempProject } from "./__fixtures__/manager-fakes"
import { createTaskManager } from "./manager"

afterEach(cleanupProjects)

function pausedChildHeldBy(host: { readonly pid?: number }, alive: (pid: number) => boolean) {
  const project = tempProject()
  const store = createTaskRecordStore(ownedTaskState(project))
  const record = seedRecord(store, { task_id: "st_0e1d0f00", status: "paused", run_epoch: 0 })
  store.mutate(record.task_id, (fresh) => ({
    ...fresh,
    ...(host.pid === undefined ? {} : { host_pid: host.pid }),
    run_pause: { parent_session_id: "parent-1", parent_pause_seq: 16, run_ref: { kind: "task", id: record.task_id } },
  }))
  const fake = makeHandle(record.task_id)
  const runner = { start: async (spec: { taskId: string }) => ({ ...fake.handle, task_id: spec.taskId }) }
  const manager = createTaskManager({
    store,
    runners: { "in-process": runner, process: runner },
    planner: categoryPlanner(),
    config: settings(),
    cwd: project,
    hostPid: 111,
    isProcessAlive: alive,
  })
  return { manager, store, taskId: record.task_id }
}

test("#given a paused child held by a live foreign host #when the manager is asked to end it #then it stays paused for that host", () => {
  const f = pausedChildHeldBy({ pid: 424_242 }, () => true)

  // when
  const ended = f.manager.endLostPausedTask(f.taskId, "respawn_failed")

  // then
  expect(ended).toBe(false)
  expect(f.store.load(f.taskId)?.status).toBe("paused")
})

test("#given a paused child whose foreign host is dead #when the manager is asked to end it #then its run ends as a session_unavailable error", () => {
  const f = pausedChildHeldBy({ pid: 424_242 }, () => false)

  // when
  const ended = f.manager.endLostPausedTask(f.taskId, "respawn_failed")

  // then
  expect(ended).toBe(true)
  const record = f.store.load(f.taskId)
  expect(record?.status).toBe("error")
  expect(record?.run_pause).toBeUndefined()
})

test.each([
  ["no host pid at all", { pid: undefined }],
  ["this host's own pid", { pid: 111 }],
])(
  "#given a paused child held by %s #when the manager is asked to end it #then it ends even while every pid reads alive",
  (_label, host) => {
    const f = pausedChildHeldBy(host, () => true)

    // when
    const ended = f.manager.endLostPausedTask(f.taskId, "respawn_failed")

    // then
    expect(ended).toBe(true)
    expect(f.store.load(f.taskId)?.status).toBe("error")
  },
)
