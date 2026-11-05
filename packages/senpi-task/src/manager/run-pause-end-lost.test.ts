import { afterEach, expect, test } from "bun:test"
import { seedRecord } from "../lifecycle/__fixtures__/lifecycle-fakes"
import { createTaskRecordStore } from "../store"
import { cleanupProjects, makeHandle, tempProject } from "./__fixtures__/manager-fakes"
import { TaskConcurrency } from "./concurrency"
import { createTaskRunPause } from "./run-pause"

afterEach(cleanupProjects)

const unusedChild = {
  pauseForRun: async () => ({ childSeq: 0 }),
  resumeTurn: async () => ({ otherHoldLive: true as const }),
  holdInput: async () => ({ kind: "held" as const, entryId: "unused", duplicate: false }),
}

function pausedChild(options: { readonly liveHandle: boolean }) {
  const store = createTaskRecordStore({ project_dir: tempProject() })
  const record = seedRecord(store, { task_id: "st_0e1d0001", status: "paused", run_epoch: 0 })
  store.mutate(record.task_id, (fresh) => ({
    ...fresh,
    run_pause: { parent_session_id: "parent-1", parent_pause_seq: 16, run_ref: { kind: "task", id: record.task_id } },
  }))
  const concurrency = new TaskConcurrency({ provider_concurrency: { test: 1 } })
  expect(concurrency.tryAcquire(record.model, record.task_id, 0)).toBe(true)
  const handle = makeHandle(record.task_id).handle
  const pause = createTaskRunPause({
    store,
    concurrency,
    now: () => Date.parse("2026-11-03T04:28:14.000Z"),
    child: unusedChild,
    liveHandle: () => (options.liveHandle ? handle : undefined),
    track: () => {},
  })
  return { store, concurrency, pause, taskId: record.task_id, model: record.model }
}

test("#given a paused child the run's Resume could not restore #when its run is ended #then it is a session_unavailable error with its pause cleared and its lane slot freed", () => {
  const f = pausedChild({ liveHandle: false })

  const ended = f.pause.endLostPausedTask(f.taskId, "paused child restore failed (respawn_failed): rpc respawn failed")

  expect(ended).toBe(true)
  const record = f.store.load(f.taskId)
  expect(record).toMatchObject({ status: "error", failure_kind: "session_unavailable" })
  expect(record?.error_message).toContain("respawn_failed")
  expect(record?.run_pause).toBeUndefined()
  expect(f.concurrency.leaseState(f.taskId, 0)).toBeUndefined()
  expect(f.concurrency.tryAcquire(f.model, "st_0e1d0002", 0)).toBe(true)
})

test("#given a paused child another host took over #when ending its run is asked #then the ownership check on the fresh record keeps it paused", () => {
  const f = pausedChild({ liveHandle: false })
  f.store.mutate(f.taskId, (fresh) => ({ ...fresh, host_pid: 424242 }))

  expect(f.pause.endLostPausedTask(f.taskId, "respawn_failed", (fresh) => fresh.host_pid !== 424242)).toBe(false)

  expect(f.store.load(f.taskId)).toMatchObject({ status: "paused", run_pause: { parent_pause_seq: 16 } })
  expect(f.concurrency.leaseState(f.taskId, 0)).toBe("held")
})

test("#given a paused child whose handle is still live #when ending its run is asked #then it stays paused for the next Resume", () => {
  const f = pausedChild({ liveHandle: true })

  expect(f.pause.endLostPausedTask(f.taskId, "resume_for_run timed out")).toBe(false)

  expect(f.store.load(f.taskId)).toMatchObject({ status: "paused" })
  expect(f.concurrency.leaseState(f.taskId, 0)).toBe("held")
})
